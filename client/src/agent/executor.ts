import {
	Box,
	createShapeId,
	renderPlaintextFromRichText,
	toRichText,
	type Editor,
	type TLArrowBinding,
	type TLDefaultColorStyle,
	type TLShape,
	type TLShapeId,
	type TLShapePartial,
} from 'tldraw'
import { NOTE_METRICS, toneOf } from '../../../shared/critique.ts'
import {
	applySpec,
	foldHeight,
	humanLayerName,
	statusTone,
	contrast,
	DEFAULT_THEME,
	inkOn,
	LINE_HEIGHT,
	parseHex as parseHexColor,
	resolveColor,
	type AuditIssue,
	skeletonSpec,
	type SkeletonKind,
	unsupportedClaim,
	DEVICES,
	hugWidth,
	isContainerKind,
	KIND_DEFAULTS,
	kindDefaults,
	layoutTree,
	normalizeKind,
	specToTree,
	toLayoutNode,
	type Device,
	type ThemeSpec,
	type UiMeta,
	type UiNodeSpec,
	type UiProps,
	type UiTreeNode,
	type LayoutSpec,
} from '../../../shared/design.ts'
import { AGENT_NAME, type Author, type ToolResult } from '../../../shared/protocol.ts'
import { measureTextDom } from '../design/measure.ts'
import { readUiTree, uiChildren, uiMeta } from '../design/tree.ts'
import { backdropFor, themeFor, type UiShape } from '../design/UiShapeUtil.tsx'
import { AGENT_AUTHOR, asAgent, authorOf } from './authorship.ts'
import { findFreeSpot, fitBounds, nextScreenPosition, unionBounds } from './layout.ts'

type Args = Record<string, any>

const COLORS = new Set(['black', 'grey', 'blue', 'green', 'red', 'orange', 'yellow', 'violet', 'light-blue', 'light-green', 'light-red', 'light-violet', 'white'])
const color = (c: unknown, fallback: TLDefaultColorStyle = 'black') =>
	(typeof c === 'string' && COLORS.has(c) ? c : fallback) as TLDefaultColorStyle

const toId = (id: unknown): TLShapeId => {
	const s = String(id ?? '').trim()
	if (s.startsWith('shape:')) return s as TLShapeId
	return createShapeId(s.replace(/[^a-zA-Z0-9_-]/g, '_') || crypto.randomUUID())
}
const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t)
const bare = (id: string) => id.replace(/^shape:/, '')
const cleanId = (id: unknown) => bare(toId(id))

const agentMeta = (extra: Args = {}) => ({ author: AGENT_AUTHOR, ...extra })

const isUi = (s: TLShape | undefined): s is UiShape => s?.type === 'ui'
const isScreen = (s: TLShape | undefined): s is UiShape => isUi(s) && s.props.kind === 'screen'
const isContainer = (s: TLShape | undefined): s is UiShape => isUi(s) && isContainerKind(s.props.kind)

/** Spec fields update_node accepts (everything except id/children). */
const SPEC_KEYS = [
	'name', 'text', 'icon', 'width', 'height', 'fill', 'textColor', 'stroke', 'strokeWidth', 'radius', 'fontSize', 'fontWeight',
	'align', 'shadow', 'opacity', 'checked', 'layout', 'gap', 'padding', 'alignItems', 'justify',
	'chart', 'data', 'labels', 'highlight', 'prefix', 'suffix', 'tabs', 'activeTab', 'trailingIcon',
] as const

export type ExecutorHooks = {
	/** Where the agent "is" on the canvas, for its presence cursor. */
	onAgentCursor?: (x: number, y: number) => void
	/**
	 * Run edits as the local user instead of the agent (the app shell: Design
	 * panel, Layers, Insert menu). Shapes are then stamped with the user as
	 * author/updatedBy by registerAuthorship, and each call is one undo step.
	 */
	asUser?: boolean
}

/**
 * Applies Grok's tool calls to the tldraw editor. Edits go into the synced
 * store, so every user in the room sees them. Design nodes are 'ui' shapes;
 * after each structural edit the affected screen is re-laid out with the
 * shared auto-layout engine.
 */
export class CanvasExecutor {
	constructor(
		private editor: Editor,
		private hooks: ExecutorHooks = {}
	) {}

	async run(name: string, args: Args): Promise<ToolResult> {
		try {
			if (this.hooks.asUser) this.editor.markHistoryStoppingPoint(name)
			const fn = (this as any)[name] as ((a: Args) => unknown) | undefined
			if (typeof fn !== 'function' || name === 'run' || name.startsWith('_')) {
				return { ok: false, error: `Unknown tool ${name}` }
			}
			const out = await fn.call(this, args ?? {})
			if (out && typeof out === 'object' && 'ok' in (out as any)) return out as ToolResult
			return { ok: true, data: out }
		} catch (err: any) {
			return { ok: false, error: err?.message ?? String(err) }
		}
	}

	// ------------------------------------------------------------ helpers

	/** Runs an edit as the agent, or as the local user when hooks.asUser is set. */
	private _act<T>(fn: () => T): T {
		return this.hooks.asUser ? fn() : asAgent(fn)
	}

	private _label(shape: TLShape): string {
		if (isUi(shape)) return shape.props.text || shape.props.name
		const rt = (shape.props as any).richText
		return rt ? renderPlaintextFromRichText(this.editor, rt).trim() : ''
	}

	private _point(x: number, y: number) {
		this.hooks.onAgentCursor?.(x, y)
	}

	/**
	 * Parks the agent's cursor just past the bottom-right corner of what it worked on,
	 * so its name chip sits beside the element instead of covering it (or a note's text).
	 */
	private _pointAt(id: TLShapeId) {
		const b = this.editor.getShapePageBounds(id)
		if (b) this._point(b.maxX + 6, b.maxY + 6)
	}

	private _knownIds(filter: (s: TLShape) => boolean = () => true, max = 60) {
		const ids = this.editor.getCurrentPageShapes().filter(filter).map((s) => bare(s.id))
		return ids.length ? ids.slice(0, max).join(', ') + (ids.length > max ? ', ...' : '') : '(none)'
	}

	private _require(id: unknown): TLShape {
		const shape = this.editor.getShape(toId(id))
		if (!shape) throw new Error(`No shape with id "${id}". Existing ids: ${this._knownIds()}`)
		return shape
	}

	private _requireUi(id: unknown): UiShape {
		const shape = this.editor.getShape(toId(id))
		if (!isUi(shape)) {
			throw new Error(
				`No design node with id "${id}"${shape ? ` (it is a ${shape.type} shape)` : ''}. Existing nodes: ${this._knownIds(isUi)}`
			)
		}
		return shape
	}

	private _requireContainer(id: unknown): UiShape {
		const shape = this.editor.getShape(toId(id))
		if (!isContainer(shape)) {
			const any = shape as TLShape | undefined
			const what = isUi(any) ? ` (it is a ${any.props.kind}, which can't have children)` : any ? ` (it is a ${any.type} shape)` : ''
			throw new Error(`No screen or frame with id "${id}"${what}. Screens/frames: ${this._knownIds(isContainer)}`)
		}
		return shape
	}

	private _requireScreen(id: unknown): UiShape {
		const shape = this.editor.getShape(toId(id))
		if (!isScreen(shape)) throw new Error(`No screen with id "${id}". Screens: ${this._knownIds(isScreen)}`)
		return shape
	}

	/** Topmost ui ancestor (usually the screen) that owns the layout of `shape`. */
	private _layoutRoot(shape: TLShape): UiShape | null {
		let root: UiShape | null = isUi(shape) ? shape : null
		let cur = this.editor.getShape(shape.parentId as TLShapeId)
		while (cur) {
			if (isUi(cur)) root = cur
			cur = this.editor.getShape(cur.parentId as TLShapeId)
		}
		return root
	}

	private _screenOf(shape: TLShape): UiShape | null {
		let cur: TLShape | undefined = shape
		while (cur) {
			if (isScreen(cur)) return cur
			cur = this.editor.getShape(cur.parentId as TLShapeId)
		}
		return null
	}

	private _meta(shape: UiShape): UiMeta {
		return uiMeta(shape)
	}

	/** Children of a ui container in layout order. */
	private _children(shape: TLShape): UiShape[] {
		return uiChildren(this.editor, shape)
	}

	/** Reads a ui subtree from the editor into a resolved tree. */
	private _toTree(shape: UiShape): UiTreeNode {
		return readUiTree(this.editor, shape)
	}

	/**
	 * Charts whose data is in thousands ($42 ... $62) next to KPIs in full dollars
	 * ($62,410) get a 'k' suffix, so the axis reads $75k instead of $75.
	 */
	private _fixChartUnits(root: UiShape) {
		const editor = this.editor
		const all = editor.getShapeAndDescendantIds([root.id])
		const shapes = [...all].map((id) => editor.getShape(id)).filter(isUi)
		const charts = shapes.filter((s) => s.props.kind === 'chart' && this._meta(s).chart)
		if (!charts.length) return
		const amounts: number[] = []
		for (const s of shapes) {
			if (s.props.kind !== 'text' || !s.props.text) continue
			for (const m of s.props.text.matchAll(/[$€£]\s?(\d{1,3}(?:,\d{3})+)(?![\d.]*\s*[kKmM])/g)) amounts.push(Number(m[1].replace(/,/g, '')))
		}
		if (!amounts.length) return
		const updates: TLShapePartial[] = []
		for (const c of charts) {
			const chart = this._meta(c).chart!
			if (chart.suffix || !chart.prefix || !/[$€£]/.test(chart.prefix)) continue
			const max = Math.max(...chart.data)
			if (!(max > 0 && max < 1000)) continue
			if (!amounts.some((a) => a / 1000 >= max * 0.2 && a / 1000 <= max * 5)) continue
			updates.push({ id: c.id, type: 'ui', meta: { ...c.meta, chart: { ...chart, suffix: 'k' } } } as TLShapePartial)
		}
		if (updates.length) editor.updateShapes(updates)
	}

	/** Re-runs auto layout on a screen/root and writes back the changed boxes. */
	private _relayout(root: UiShape | null) {
		if (!root || !this.editor.getShape(root.id)) return
		const editor = this.editor
		if (!this.hooks.asUser) {
			this._fixChartUnits(root)
			this._fitToFold(editor.getShape(root.id) as UiShape)
		}
		const tree = this._toTree(editor.getShape(root.id) as UiShape)
		const node = toLayoutNode(tree)
		let boxes = layoutTree(node, { measure: measureTextDom })
		// A screen whose content doesn't fit grows taller, like a scrolling page in Figma,
		// instead of clipping it (it never shrinks on its own).
		if (!this.hooks.asUser && tree.props.kind === 'screen' && node.layout && node.layout.mode !== 'none') {
			const need = layoutTree({ ...node, sizing: { ...node.sizing, h: 'hug' } }, { measure: measureTextDom }).get(node.id)?.h ?? 0
			// A long page (taller than any device) hugs its content, so it never ends in a blank band.
			const longPage = node.w >= 1000 && node.h > 1100 && need < node.h - 40
			if (need > node.h + 1 || longPage) {
				node.h = Math.ceil(longPage ? Math.max(1024, need) : need)
				boxes = layoutTree(node, { measure: measureTextDom })
			}
		}
		const updates: TLShapePartial[] = []
		const walk = (n: UiTreeNode, isRoot: boolean) => {
			const b = boxes.get(n.id)
			if (b) {
				const s = editor.getShape(toId(n.id)) as UiShape
				const changed =
					(!isRoot && (Math.abs(s.x - b.x) > 0.01 || Math.abs(s.y - b.y) > 0.01)) ||
					Math.abs(s.props.w - b.w) > 0.01 ||
					Math.abs(s.props.h - b.h) > 0.01
				if (changed) {
					updates.push({ id: s.id, type: 'ui', ...(isRoot ? {} : { x: b.x, y: b.y }), props: { w: b.w, h: b.h } } as TLShapePartial)
				}
			}
			n.children.forEach((c) => walk(c, false))
		}
		walk(tree, true)
		if (updates.length) editor.updateShapes(updates)
	}

	/** The height a screen should fit in (see foldHeight), or null when it may scroll. */
	private _fold(screen: UiShape): number | null {
		if (screen.props.kind !== 'screen') return null
		return foldHeight({ w: screen.props.w, layoutMode: this._meta(screen).layout?.mode, name: screen.props.name })
	}

	/**
	 * A phone (or desktop app) screen whose content runs past the device height is
	 * tightened first: vertical gaps and paddings shrink step by step (never under
	 * 4-8px) until it fits. When even that isn't enough the screen grows and the
	 * tool result warns, so the model drops rows in the same turn.
	 */
	private _fitToFold(screen: UiShape | undefined) {
		if (!screen || screen.props.kind !== 'screen') return
		const fold = this._fold(screen)
		if (!fold) return
		const tree = this._toTree(screen)
		const hugNeed = (t: UiTreeNode) => {
			const n = toLayoutNode(t)
			return layoutTree({ ...n, sizing: { ...n.sizing, h: 'hug' } }, { measure: measureTextDom }).get(n.id)?.h ?? 0
		}
		if (hugNeed(tree) <= fold + 1) return
		const original = new Map<string, LayoutSpec>()
		const walk = (n: UiTreeNode, fn: (n: UiTreeNode) => void) => {
			fn(n)
			n.children.forEach((c) => walk(c, fn))
		}
		walk(tree, (n) => {
			if (n.meta.layout && n.meta.layout.mode !== 'none') original.set(n.id, { ...n.meta.layout, padding: [...n.meta.layout.padding] as LayoutSpec['padding'] })
		})
		const shrink = (v: number, f: number, min: number) => (v <= min ? v : Math.max(min, Math.round(v * f)))
		for (const f of [0.85, 0.7, 0.55]) {
			walk(tree, (n) => {
				const o = original.get(n.id)
				if (!o) return
				const [t, r, b, l] = o.padding
				const isScreen = n.props.kind === 'screen'
				n.meta.layout = {
					...o,
					gap: o.mode === 'vertical' ? shrink(o.gap, f, isScreen ? 12 : 4) : o.gap,
					padding: [shrink(t, f, isScreen ? 16 : 4), r, shrink(b, f, isScreen ? 16 : 4), l],
				}
			})
			if (hugNeed(tree) > fold + 1) continue
			const updates: TLShapePartial[] = []
			walk(tree, (n) => {
				const o = original.get(n.id)
				const l = n.meta.layout
				if (!o || !l || (o.gap === l.gap && o.padding.every((v, i) => v === l.padding[i]))) return
				const shape = this.editor.getShape(toId(n.id)) as UiShape | undefined
				if (shape) updates.push({ id: shape.id, type: 'ui', meta: { ...shape.meta, layout: l } } as TLShapePartial)
			})
			if (updates.length) this.editor.updateShapes(updates)
			// A screen that grew earlier goes back to its device height.
			if (screen.props.h > fold) this.editor.updateShape({ id: screen.id, type: 'ui', props: { h: fold } } as TLShapePartial)
			return
		}
	}

	/** The first text-bearing node of a screen whose bottom is past `fold` (what a person can't see without scrolling). */
	private _belowFold(screen: UiShape, fold: number): string | null {
		const sb = this.editor.getShapePageBounds(screen.id)
		if (!sb) return null
		let best: { y: number; label: string; rank: number } | null = null
		const walk = (s: UiShape) => {
			const kids = this._children(s)
			if (!kids.length && s.id !== screen.id) {
				const b = this.editor.getShapePageBounds(s.id)
				const label = s.props.text?.trim()
				if (b && label && b.maxY - sb.y > fold + 1) {
					const rank = s.props.kind === 'button' ? 0 : s.props.kind === 'text' && s.props.fontWeight >= 600 ? 1 : 2
					if (!best || rank < best.rank || (rank === best.rank && b.y < best.y)) best = { y: b.y, label, rank }
				}
			}
			kids.forEach(walk)
		}
		walk(screen)
		return (best as { label: string } | null)?.label ?? null
	}

	/** A readable name for a node in a sentence: its text in quotes, else its layer name. */
	private _say(s: UiShape): string {
		const p = s.props
		if (p.text && ['text', 'button', 'badge', 'input', 'checkbox'].includes(p.kind)) return `"${p.text.length > 40 ? `${p.text.slice(0, 38)}…` : p.text}"`
		const name = p.name && p.name !== bare(s.id) ? p.name : humanLayerName({ id: bare(s.id), kind: p.kind }, null)
		return `the ${name.toLowerCase()}`
	}

	/**
	 * Layer names people can read: a node named only by its id ("ob_art", "set_acct")
	 * gets one from its id's words, its section heading and its kind ("Hero art",
	 * "Account section"). Text-like nodes show their text in Layers, so they keep the id.
	 */
	private _nameLayers(tree: UiTreeNode, screen: { id: string; name: string } | null) {
		const walk = (n: UiTreeNode) => {
			if (!['text', 'button', 'input', 'checkbox', 'badge', 'screen'].includes(n.props.kind) && (!n.props.name || n.props.name === n.id)) {
				const kids = [...n.children].sort((a, b) => (a.meta.order ?? 0) - (b.meta.order ?? 0))
				const isHeading = (c: UiTreeNode) => c.props.kind === 'text' && c.props.fontWeight >= 600 && c.props.text.length <= 28 && !/[\d$€£%]/.test(c.props.text)
				const heading =
					n.props.kind === 'frame' && kids.length >= 2
						? (kids.slice(0, 2).find(isHeading) ?? kids.slice(0, 1).flatMap((c) => [...c.children].sort((a, b) => (a.meta.order ?? 0) - (b.meta.order ?? 0)).slice(0, 2)).find(isHeading))?.props.text
						: undefined
				const name = humanLayerName({ id: n.id, kind: n.props.kind, heading, fill: n.props.fill, stroke: n.props.stroke, h: n.props.h }, screen)
				if (name) {
					n.props.name = name
					;(n.meta as Args).autoName = name
				}
			}
			n.children.forEach(walk)
		}
		walk(tree)
	}

	/** Status badges ("Sent", "Pending") get their semantic token pair instead of the brand color. */
	private _semanticBadges(tree: UiTreeNode) {
		const walk = (n: UiTreeNode) => {
			if (n.props.kind === 'badge') {
				const tone = statusTone(n.props.text)
				if (tone && /^\$(primary|primarySoft|onPrimary)$/.test(n.props.fill) && /^\$(primary|onPrimary|primarySoft|text)$/.test(n.props.textColor)) {
					n.props.fill = `$${tone}Soft`
					n.props.textColor = `$${tone}`
				}
			}
			n.children.forEach(walk)
		}
		walk(tree)
	}

	/** Makes every id in `tree` (except the root) unique on the page; returns renames. */
	private _dedupeIds(tree: UiTreeNode, prefix: string, replaceable: Set<string> = new Set()) {
		const renamed: Record<string, string> = {}
		const used = new Set<string>()
		const taken = (id: string) => used.has(id) || (!!this.editor.getShape(toId(id)) && !replaceable.has(id))
		const walk = (n: UiTreeNode, isRoot: boolean) => {
			n.id = cleanId(n.id || `${prefix}_${n.props.kind}`)
			if (!isRoot && taken(n.id)) {
				const original = n.id
				let candidate = n.id.startsWith(`${prefix}_`) ? n.id : `${prefix}_${n.id}`
				for (let k = 2; taken(candidate); k++) candidate = `${prefix}_${original}_${k}`
				renamed[original] = candidate
				n.id = candidate
			}
			used.add(n.id)
			n.children.forEach((c) => walk(c, false))
		}
		walk(tree, true)
		return renamed
	}

	/** Creates the shapes of a resolved tree (root included) under `parentId`. */
	private _createTree(tree: UiTreeNode, parentId: TLShapeId | undefined, rootExtraMeta: Args = {}) {
		const partials: TLShapePartial[] = []
		const walk = (n: UiTreeNode, parent: TLShapeId | undefined, isRoot: boolean) => {
			const id = toId(n.id)
			partials.push({
				id,
				type: 'ui',
				x: n.x,
				y: n.y,
				...(parent ? { parentId: parent } : {}),
				props: n.props,
				meta: agentMeta({ ...n.meta, ...(isRoot ? rootExtraMeta : {}) }),
			} as TLShapePartial)
			n.children.forEach((c) => walk(c, id, false))
		}
		walk(tree, parentId, true)
		this.editor.createShapes(partials as any)
	}

	/** Writes meta.order for a parent's children in the given order. */
	private _setOrder(children: UiShape[]) {
		this.editor.updateShapes(children.map((c, i) => ({ id: c.id, type: 'ui', meta: { ...c.meta, order: i } }) as TLShapePartial))
	}

	/**
	 * Compact nested summary of a ui subtree, for the model. Anything equal to the
	 * kind's default (see KIND_DEFAULTS) is left out, and children of auto-layout
	 * parents carry no x/y (the layout computes them), which keeps big screens
	 * cheap in tokens.
	 */
	private _node(shape: UiShape, brief = false, parentAuto = false): Args {
		const p = shape.props
		const m = this._meta(shape)
		const d = kindDefaults(p.kind)
		const out: Args = { id: bare(shape.id), type: p.kind }
		if (p.name && p.name !== out.id && (shape.meta as Args)?.autoName !== p.name) out.name = p.name
		if (p.text) out.text = p.text
		if (p.icon && ['icon', 'button', 'input', 'avatar', 'image', 'badge'].includes(p.kind) && (p.kind !== 'icon' || p.icon !== d.props.icon)) out.icon = p.icon
		if (isScreen(shape)) {
			const b = this.editor.getShapePageBounds(shape)!
			Object.assign(out, { x: Math.round(b.x), y: Math.round(b.y) })
		} else if (!parentAuto) Object.assign(out, { x: Math.round((shape as UiShape).x), y: Math.round((shape as UiShape).y) })
		Object.assign(out, { w: Math.round(p.w), h: Math.round(p.h) })
		// Sizing only when it differs from the kind's default ('fixed' means w/h are fixed numbers).
		if (m.sizing.w !== d.meta.sizing.w) out.width = m.sizing.w
		if (m.sizing.h !== d.meta.sizing.h) out.height = m.sizing.h
		if (!brief) {
			const dp = d.props
			for (const k of ['fill', 'textColor', 'stroke', 'radius', 'shadow', 'opacity', 'align'] as const) {
				if (p[k] !== dp[k]) out[k] = p[k]
			}
			if (p.stroke !== 'transparent' && p.strokeWidth !== dp.strokeWidth) out.strokeWidth = p.strokeWidth
			if (['text', 'button', 'input', 'checkbox', 'avatar', 'badge'].includes(p.kind)) {
				if (p.fontSize !== dp.fontSize) out.fontSize = p.fontSize
				if (p.fontWeight !== dp.fontWeight) out.fontWeight = p.fontWeight
			} else delete out.align
			if (['icon', 'image', 'rect', 'toggle', 'divider', 'screen', 'frame', 'chart'].includes(p.kind)) delete out.textColor
			if (m.chart && p.kind === 'chart') Object.assign(out, { chart: m.chart.type, data: m.chart.data, ...(m.chart.labels.length ? { labels: m.chart.labels } : {}), ...(m.chart.highlight !== undefined ? { highlight: m.chart.highlight } : {}), ...(m.chart.prefix ? { prefix: m.chart.prefix } : {}), ...(m.chart.suffix ? { suffix: m.chart.suffix } : {}) })
			if (m.trailingIcon && p.kind === 'input') out.trailingIcon = m.trailingIcon
			if ((p.kind === 'toggle' || p.kind === 'checkbox') && p.checked !== dp.checked) out.checked = p.checked
			if (m.layout && isContainerKind(p.kind)) {
				const l = m.layout
				const dl = d.meta.layout
				if (l.mode !== dl?.mode) out.layout = l.mode
				if (l.mode !== 'none') {
					if (l.gap !== dl?.gap) out.gap = l.gap
					const [t, r, b, lft] = l.padding
					if (!dl || l.padding.some((v, i) => v !== dl.padding[i])) out.padding = t === r && r === b && b === lft ? t : t === b && r === lft ? [t, r] : l.padding
					if (l.alignItems !== dl?.alignItems) out.alignItems = l.alignItems
					if (l.justify !== dl?.justify) out.justify = l.justify
				}
			}
			if (isScreen(shape)) {
				const theme = { ...DEFAULT_THEME, ...((shape.meta?.theme as object) ?? {}) }
				if (theme.mode !== DEFAULT_THEME.mode || theme.primary !== DEFAULT_THEME.primary) out.theme = theme
				if (m.tabs) Object.assign(out, { tabs: m.tabs.items, activeTab: m.tabs.active })
			}
			const author = authorOf(shape)
			if (author?.kind === 'user') out.author = { kind: author.kind, name: author.name }
		}
		const children = this._children(shape)
		const auto = isContainerKind(p.kind) && (m.layout?.mode ?? 'none') !== 'none'
		if (children.length) out.children = children.map((c) => this._node(c, brief, auto))
		return out
	}

	/**
	 * Tables whose header and rows don't share column positions (cells that hug
	 * their text instead of fixed widths). Returns the container ids.
	 */
	private _misalignedTables(root: UiShape): string[] {
		const editor = this.editor
		const out: string[] = []
		const isRow = (k: UiShape) => k.props.kind === 'frame' && this._meta(k).layout?.mode === 'horizontal' && this._children(k).length >= 3
		const walk = (s: UiShape) => {
			const kids = this._children(s)
			if (isContainerKind(s.props.kind) && kids.length) {
				// Rows directly inside, or one level down (a header row + a frame of template rows).
				const rows = [...kids.filter(isRow), ...kids.filter((k) => k.props.kind === 'frame' && !isRow(k)).flatMap((k) => this._children(k).filter(isRow))]
				const byCount = new Map<number, UiShape[]>()
				for (const r of rows) byCount.set(this._children(r).length, [...(byCount.get(this._children(r).length) ?? []), r])
				for (const group of byCount.values()) {
					// A table: one of the rows is a header (text cells only).
					if (group.length < 3 || !group.some((r) => this._children(r).every((c) => c.props.kind === 'text'))) continue
					const cols = group.map((r) => this._children(r).map((c) => editor.getShapePageBounds(c.id)!).map((b) => [b.x, b.maxX]))
					const n = cols[0].length
					let bad = false
					for (let i = 1; i < n && !bad; i++) {
						const lefts = cols.map((c) => c[i][0])
						const rights = cols.map((c) => c[i][1])
						// A column lines up when its cells share a left edge or a right edge (right-aligned amounts).
						if (Math.max(...lefts) - Math.min(...lefts) > 4 && Math.max(...rights) - Math.min(...rights) > 4) bad = true
					}
					if (bad) out.push(bare(s.id))
				}
			}
			kids.forEach(walk)
		}
		walk(root)
		return [...new Set(out)]
	}

	/** Warnings about content that doesn't fit, so the model can fix it. */
	private _warnings(stale: UiShape): string[] {
		const warnings: string[] = []
		const root = (this.editor.getShape(stale.id) as UiShape | undefined) ?? stale
		const walk = (s: UiShape) => {
			const kids = this._children(s)
			if (isContainerKind(s.props.kind) && kids.length) {
				const bottom = Math.max(...kids.map((k) => k.y + k.props.h))
				const right = Math.max(...kids.map((k) => k.x + k.props.w))
				if (bottom > s.props.h + 1) warnings.push(`Content of "${bare(s.id)}" overflows its height by ${Math.round(bottom - s.props.h)}px (clipped). Reduce content/gaps or make it taller.`)
				if (right > s.props.w + 1) warnings.push(`Content of "${bare(s.id)}" overflows its width by ${Math.round(right - s.props.w)}px (clipped).`)
				for (const k of kids) if (k.props.w < 1 && k.props.kind !== 'divider') warnings.push(`"${bare(k.id)}" has no room (width 0) in its row.`)
				for (const k of kids) {
					if (k.props.kind !== 'button' || !k.props.text || k.props.w < 1) continue
					const m = this._meta(k)
					const need = hugWidth({ id: k.id, kind: 'button', w: k.props.w, h: k.props.h, text: k.props.text, icon: k.props.icon, fontSize: k.props.fontSize, fontWeight: k.props.fontWeight, layout: m.layout, sizing: m.sizing }, measureTextDom)
					if (k.props.w + 2 < need) warnings.push(`The label of "${bare(k.id)}" is clipped: it needs ${need}px but is ${Math.round(k.props.w)}px wide. Use width 'hug', a shorter label, or drop the icon.`)
				}
			}
			kids.forEach(walk)
		}
		walk(root)
		const fold = this._fold(root)
		if (fold && root.props.h > fold + 1) {
			const below = this._belowFold(root, fold)
			const device = root.props.w >= 1000 ? 'desktop viewport' : root.props.w >= 600 ? 'tablet' : 'phone'
			warnings.push(`Screen "${bare(root.id)}" is ${Math.round(root.props.h)}px tall, past the ${fold}px ${device}${below ? `: "${below}" is below the fold` : ''}, even with tightened spacing. Make it fit now: fewer rows (2-3 per section), shorter copy, or drop a section.`)
		}
		for (const t of this._misalignedTables(root)) warnings.push(`The columns of "${t}" don't line up between the header and the rows: give each column's cells the same fixed width in the header and the row template (one column width 'fill'), right-align amounts.`)
		return warnings.slice(0, 8)
	}

	/**
	 * Measured problems on a screen, from real bounds and rendered colors: content
	 * overflowing its container, clipped labels, text contrast under 4.5:1 (3:1 for
	 * large text), phone touch targets under 44px, text under 12px, rows of cards
	 * with unequal heights. Critiques may only claim geometry/contrast issues listed here.
	 */
	_audit(screen: UiShape): AuditIssue[] {
		const editor = this.editor
		const issues: AuditIssue[] = []
		const sid = bare(screen.id)
		const theme = themeFor(editor, screen.id)
		const phone = screen.props.w < 600
		const sb = editor.getShapePageBounds(screen.id)
		const add = (s: UiShape, kind: AuditIssue['kind'], detail: string, say?: string) => issues.push({ id: bare(s.id), screen: sid, kind, detail, ...(say ? { say } : {}) })
		const screenName = screen.props.name || sid
		const walk = (s: UiShape) => {
			const p = s.props
			const kids = this._children(s)
			if (isContainerKind(p.kind) && kids.length) {
				const bottom = Math.max(...kids.map((k) => k.y + k.props.h))
				const right = Math.max(...kids.map((k) => k.x + k.props.w))
				if (bottom > p.h + 1 && s.id !== screen.id) add(s, 'overflow', `content overflows "${bare(s.id)}" by ${Math.round(bottom - p.h)}px at the bottom`, `Content spills ${Math.round(bottom - p.h)}px out of the bottom of ${this._say(s)}.`)
				if (right > p.w + 1) add(s, 'overflow', `content overflows "${bare(s.id)}" by ${Math.round(right - p.w)}px on the right`, `Content spills ${Math.round(right - p.w)}px past the right edge of ${this._say(s)}.`)
				const l = this._meta(s).layout
				const cards = kids.filter((k) => k.props.kind === 'frame' && (k.props.fill !== 'transparent' || k.props.stroke !== 'transparent'))
				if (l?.mode === 'horizontal' && cards.length >= 2) {
					const hs = cards.map((k) => k.props.h)
					if (Math.max(...hs) - Math.min(...hs) > 4) add(s, 'spacing', `cards in "${bare(s.id)}" have unequal heights (${Math.round(Math.min(...hs))}-${Math.round(Math.max(...hs))}px)`, `The cards in ${this._say(s)} have unequal heights (${Math.round(Math.min(...hs))} to ${Math.round(Math.max(...hs))}px); give the row alignItems stretch.`)
				}
			}
			const b = editor.getShapePageBounds(s.id)
			if (sb && b && s.id !== screen.id && (b.maxY > sb.maxY + 1 || b.maxX > sb.maxX + 1 || b.x < sb.x - 1 || b.y < sb.y - 1)) add(s, 'overflow', `"${bare(s.id)}" extends outside the screen`, `${cap(this._say(s))} runs past the edge of ${screenName}.`)
			const hasText = ['text', 'button', 'badge', 'input', 'checkbox'].includes(p.kind) && !!p.text
			if (hasText && p.w >= 1) {
				const wraps = p.kind === 'text' && p.h >= p.fontSize * LINE_HEIGHT * 1.5
				if (p.kind === 'text') {
					const m = measureTextDom(p.text, p.fontSize, wraps ? p.w : undefined, p.fontWeight)
					if (wraps ? m.h > p.h + 2 : m.w > p.w + 2) add(s, 'clipped', `the text of "${bare(s.id)}" doesn't fit its box`, `The text ${this._say(s)} is clipped by its box; give it room to wrap or shorten it.`)
				} else if (p.kind === 'button') {
					const m = this._meta(s)
					const need = hugWidth({ id: s.id, kind: 'button', w: p.w, h: p.h, text: p.text, icon: p.icon, fontSize: p.fontSize, fontWeight: p.fontWeight, layout: m.layout, sizing: m.sizing }, measureTextDom)
					if (p.w + 2 < need) add(s, 'clipped', `the label of "${bare(s.id)}" is clipped (needs ${Math.round(need)}px, has ${Math.round(p.w)}px)`, `The ${this._say(s)} button label is clipped: it needs ${Math.round(need)}px but has ${Math.round(p.w)}px.`)
				}
				if (p.fontSize < 12) add(s, 'small_text', `"${bare(s.id)}" is ${p.fontSize}px text`, `${cap(this._say(s))} is ${p.fontSize}px text; keep text at 12px or more so it stays readable.`)
				const bg = backdropFor(editor, s.id, theme, !['text', 'checkbox'].includes(p.kind))
				const fg = p.kind === 'input' ? resolveColor(p.textColor, theme) : inkOn(p.textColor, bg, theme)
				const large = p.fontSize >= 24 || (p.fontSize >= 18.5 && p.fontWeight >= 700)
				const ratio = contrast(fg, bg)
				if (parseHexColor(fg) && parseHexColor(bg) && ratio < (large ? 3 : 4.5)) add(s, 'contrast', `"${bare(s.id)}" text contrast is ${ratio.toFixed(1)}:1`, `${cap(this._say(s))} is only ${ratio.toFixed(1)}:1 against its background; text needs ${large ? 3 : 4.5}:1.`)
			}
			if (phone && (p.kind === 'button' || p.kind === 'input') && p.h < 44 && p.w >= 1) add(s, 'touch', `"${bare(s.id)}" is ${Math.round(p.h)}px tall (under 44)`, `${cap(this._say(s))} is ${Math.round(p.h)}px tall; touch targets need 44px.`)
			kids.forEach(walk)
		}
		walk(screen)
		// A phone (or desktop app) screen that grew past its device height scrolls: whatever is below the fold is a real finding.
		const fold = this._fold(screen)
		if (fold && screen.props.h > fold + 1) {
			const below = this._belowFold(screen, fold)
			const device = screen.props.w >= 1000 ? 'desktop viewport' : screen.props.w >= 600 ? 'tablet' : 'phone'
			issues.unshift({
				id: sid,
				screen: sid,
				kind: 'overflow',
				detail: `"${sid}" is ${Math.round(screen.props.h)}px tall, past the ${fold}px ${device}: ${below ? `"${below}" is` : 'the bottom of it is'} below the fold`,
				say: `${screenName} is ${Math.round(screen.props.h)}px tall on a ${fold}px ${device}, so ${below ? `"${below}"` : 'the end of it'} sits below the fold; tighten the sections so it fits.`,
			})
		}
		for (const t of this._misalignedTables(screen)) {
			const ts = this.editor.getShape(toId(t)) as UiShape | undefined
			issues.push({ id: t, screen: sid, kind: 'spacing', detail: `the columns of "${t}" are misaligned between header and rows`, say: `The columns of ${ts ? this._say(ts) : 'the table'} don't line up between the header and the rows.` })
		}
		return issues.slice(0, 20)
	}

	/**
	 * Where a critique note goes (see add_comment): just outside the target's screen
	 * (right, left, below, above), level with the node, clear of screens, their name
	 * labels and other notes, with the shortest leader to the node that crosses no
	 * other screen.
	 */
	private _commentSpot(id: TLShapeId, target: TLShape | null, tb: Box | null, sb: Box | null, W: number, H: number, view: Box): { x: number; y: number } {
		const editor = this.editor
		if (!tb || !sb) return { x: view.center.x - W / 2, y: view.center.y - H / 2 }
		const ownScreen = target ? this._screenOf(target) : null
		const obstacles: Box[] = []
		const otherScreens: Box[] = []
		for (const s of editor.getCurrentPageShapes()) {
			if (s.id === id || s.type === 'arrow' || (target && s.id === target.id)) continue
			if (isUi(s) && !isScreen(s)) continue
			// Outlines sit on the screens; only cards and other shapes are in the way.
			if (s.type === 'critique' && (s.props as { kind?: string }).kind === 'highlight') continue
			if (s.type === 'geo' && (s.meta as Args)?.role === 'annotation') continue
			const b = editor.getShapePageBounds(s)
			if (!b) continue
			const box = b.clone().expandBy(isScreen(s) ? 20 : 12)
			if (isScreen(s)) {
				box.y -= 28
				box.h += 28
				if (s.id !== ownScreen?.id) otherScreens.push(b)
			}
			obstacles.push(box)
		}
		const gap = 32
		const free = (b: Box) => !obstacles.some((o) => Box.Collides(o, b))
		// The leader runs from the note to the node: it must not cut through another screen.
		const crosses = (b: Box) => otherScreens.some((o) => segmentHitsBox(b.center, tb.center, o))
		const yLevel = Math.max(sb.y, Math.min(tb.center.y - H / 2, sb.maxY - H))
		const xLevel = Math.max(sb.x, Math.min(tb.center.x - W / 2, sb.maxX - W))
		const lanes: { start: Box; dx: number; dy: number; bias: number }[] = [
			{ start: new Box(sb.maxX + gap, yLevel, W, H), dx: 0, dy: 1, bias: 0 },
			{ start: new Box(sb.x - gap - W, yLevel, W, H), dx: 0, dy: 1, bias: 0 },
			{ start: new Box(xLevel, sb.maxY + gap, W, H), dx: 1, dy: 0, bias: 60 },
			{ start: new Box(xLevel, sb.y - 28 - gap - H, W, H), dx: 1, dy: 0, bias: 60 },
		]
		// Leader length: the gap between the note's edge and the node's edge.
		const leader = (b: Box) => Math.hypot(Math.max(0, b.x - tb.maxX, tb.x - b.maxX), Math.max(0, b.y - tb.maxY, tb.y - b.maxY))
		let best: { box: Box; score: number } | null = null
		for (const lane of lanes) {
			for (let k = 0; k < 60; k++) {
				// Slide along the lane: 0, +1, -1, +2, -2... steps of 16.
				const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 16
				const b = new Box(lane.start.x + lane.dx * off, lane.start.y + lane.dy * off, W, H)
				if (!free(b) || crosses(b)) continue
				const inView = b.x >= view.x && b.y >= view.y && b.maxX <= view.maxX && b.maxY <= view.maxY
				const score = leader(b) + lane.bias + (inView ? 0 : 80)
				if (!best || score < best.score) best = { box: b, score }
				break
			}
		}
		if (best) return { x: best.box.x, y: best.box.y }
		const spot = findFreeSpot(editor, lanes[0].start, { avoidAll: true, ignore: new Set([id]) })
		return { x: spot.x, y: spot.y }
	}

	private _deleteWithArrows(ids: TLShapeId[]) {
		if (ids.length) this.editor.deleteShapes(ids)
	}

	/** Creates (or recreates) an arrow bound to two shapes. */
	private _arrow(
		id: TLShapeId,
		from: TLShape,
		to: TLShape,
		props: Args,
		meta: Args,
		anchors: { start?: { x: number; y: number }; end?: { x: number; y: number } } = {}
	) {
		const editor = this.editor
		if (editor.getShape(id)) editor.deleteShapes([id])
		const a = editor.getShapePageBounds(from)!.center
		const b = editor.getShapePageBounds(to)!.center
		editor.createShape({
			id,
			type: 'arrow',
			x: a.x,
			y: a.y,
			meta,
			props: { start: { x: 0, y: 0 }, end: { x: b.x - a.x, y: b.y - a.y }, ...props },
		})
		const binding = (terminal: 'start' | 'end', target: TLShape) => {
			const anchor = anchors[terminal]
			return {
				type: 'arrow' as const,
				fromId: id,
				toId: target.id,
				props: { terminal, normalizedAnchor: anchor ?? { x: 0.5, y: 0.5 }, isExact: false, isPrecise: !!anchor, snap: 'none' as const },
			}
		}
		editor.createBindings<TLArrowBinding>([binding('start', from), binding('end', to)])
	}

	/** Flat summary of a non-design shape (sketches, notes, arrows, comments). */
	private _serialize(shape: TLShape) {
		const editor = this.editor
		const b = editor.getShapePageBounds(shape)
		const p = shape.props as any
		const out: Args = { id: bare(shape.id), type: shape.type }
		if (p.geo) out.geo = p.geo
		const label = this._label(shape)
		if (label) out.label = label
		if (p.color) out.color = p.color
		if (b) Object.assign(out, { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) })
		const author = authorOf(shape)
		if (author) out.author = { kind: author.kind, name: author.name }
		if (shape.meta?.role) out.role = shape.meta.role
		if (shape.meta?.kind) out.kind = shape.meta.kind
		if (shape.type === 'arrow') {
			for (const binding of editor.getBindingsFromShape<TLArrowBinding>(shape, 'arrow')) {
				out[binding.props.terminal === 'start' ? 'fromId' : 'toId'] = bare(binding.toId)
			}
		}
		if (shape.type === 'draw' || shape.type === 'highlight') out.note = 'freehand ink: use get_canvas_image to see it'
		return out
	}

	private _scopeShapes(args: Args): TLShape[] {
		const editor = this.editor
		let shapes = editor.getCurrentPageShapesSorted()
		if (Array.isArray(args.shapeIds) && args.shapeIds.length) {
			const ids = new Set(args.shapeIds.map((id: string) => toId(id)))
			// Include arrows connected to the requested shapes so connections are visible.
			shapes = shapes.filter(
				(s) =>
					ids.has(s.id) ||
					(s.type === 'arrow' && editor.getBindingsFromShape<TLArrowBinding>(s, 'arrow').some((b) => ids.has(b.toId)))
			)
		}
		const r = args.region
		if (r && [r.x, r.y, r.w, r.h].every((v) => typeof v === 'number')) {
			const region = new Box(r.x, r.y, r.w, r.h)
			shapes = shapes.filter((s) => {
				const b = editor.getShapePageBounds(s)
				return b && Box.Collides(b, region)
			})
		}
		return shapes
	}

	// ---------------------------------------------------------- design tools

	/**
	 * Not a model tool: the server calls it the moment a new screen is requested,
	 * so a placeholder screen (soft blocks where the sections will go) is on the
	 * canvas within a second. The turn's first new create_screen replaces it in place.
	 */
	create_skeleton(args: Args) {
		const editor = this.editor
		this.remove_skeleton()
		const device = (DEVICES[args.device as Device] ? args.device : 'iphone') as Device
		const kind = (['dashboard', 'landing', 'login', 'onboarding', 'settings', 'list'].includes(args.kind) ? args.kind : 'list') as SkeletonKind
		const id = cleanId(args.id ?? `skeleton_${Date.now().toString(36)}`)
		const prefix = (n: UiNodeSpec): UiNodeSpec => ({ ...n, id: n.id === 'sk' ? id : `${id}_${n.id}`, ...(n.children ? { children: n.children.map(prefix) } : {}) })
		this.create_screen({ ...prefix(skeletonSpec(kind, device)), id, device, name: String(args.name ?? 'New screen') })
		this._act(() => editor.updateShape({ id: toId(id), type: 'ui', meta: { ...editor.getShape(toId(id))!.meta, skeleton: true } } as TLShapePartial))
		const b = editor.getShapePageBounds(toId(id))
		const v = editor.getViewportPageBounds()
		if (b && !(b.x >= v.x && b.y >= v.y && b.maxX <= v.maxX && b.maxY <= v.maxY)) {
			const others = editor.getCurrentPageShapes().filter(isScreen)
			fitBounds(editor, unionBounds(editor, others.length <= 3 ? others : [editor.getShape(toId(id))])!, { inset: 64 })
		}
		return { id }
	}

	/** Removes a leftover skeleton screen (a turn that never built its screen). */
	remove_skeleton() {
		const ids = this.editor.getCurrentPageShapes().filter((s) => isScreen(s) && s.meta?.skeleton).map((s) => s.id)
		if (ids.length) this._act(() => this.editor.deleteShapes(ids))
		return { removed: ids.length }
	}

	create_screen(args: Args) {
		const editor = this.editor
		if (!args.id) throw new Error('create_screen needs an id')
		const id = toId(args.id)
		const existing = editor.getShape(id)
		// The first real screen of the turn takes the skeleton's place.
		const skeleton = !existing ? (editor.getCurrentPageShapes().find((s) => isScreen(s) && s.meta?.skeleton) as UiShape | undefined) : undefined
		if (existing && !isScreen(existing)) {
			throw new Error(`Id "${bare(id)}" is already used by a ${(existing as TLShape).type === 'ui' ? ((existing as TLShape).props as UiProps).kind : (existing as TLShape).type}. Pick another screen id.`)
		}
		const device = DEVICES[args.device as Device]
		const w = Number(args.width) || device?.w || (existing as UiShape | undefined)?.props.w || DEVICES.iphone.w
		const h = Number(args.height) || device?.h || (existing as UiShape | undefined)?.props.h || DEVICES.iphone.h
		const { theme, primary, device: _d, x, y, ...spec } = args
		const tree = specToTree({ ...(spec as UiNodeSpec), id: bare(id), width: w, height: h }, 'screen')
		tree.props.name = String(args.name ?? (existing as UiShape | undefined)?.props.name ?? bare(id))
		// A replaced screen keeps its theme; a new one follows the latest screen, so
		// "add a sign-up screen" after "dark mode" stays dark.
		const latest = editor.getCurrentPageShapesSorted().filter((s) => isScreen(s) && s.id !== skeleton?.id).at(-1) ?? skeleton
		const prevTheme = ((existing ?? latest)?.meta?.theme as Partial<ThemeSpec> | undefined) ?? {}
		const themeMeta: ThemeSpec = {
			mode: theme === 'dark' || theme === 'light' ? theme : (prevTheme.mode ?? 'light'),
			primary: typeof primary === 'string' && primary ? primary : (prevTheme.primary ?? DEFAULT_THEME.primary),
		}
		const pos =
			typeof x === 'number' && typeof y === 'number'
				? { x, y }
				: existing
					? { x: typeof x === 'number' ? x : existing.x, y: typeof y === 'number' ? y : existing.y }
					: skeleton
						? { x: skeleton.x, y: skeleton.y }
						: nextScreenPosition(editor, w, h)
		tree.x = pos.x
		tree.y = pos.y
		const replaceable = new Set(existing ? editor.getShapeAndDescendantIds([existing.id]) : skeleton ? editor.getShapeAndDescendantIds([skeleton.id]) : [])
		const renamedRaw = this._dedupeIds(tree, bare(id), new Set([...replaceable].map(bare)))
		if (!this.hooks.asUser) {
			this._semanticBadges(tree)
			this._nameLayers(tree, { id: bare(id), name: tree.props.name })
		}

		this._act(() =>
			editor.run(() => {
				if (existing) {
					editor.deleteShapes(editor.getSortedChildIdsForParent(existing.id))
					editor.updateShape({
						id,
						type: 'ui',
						x: pos.x,
						y: pos.y,
						props: tree.props,
						// A rebuild replaces the tab bar too (none in the new spec = none).
						meta: { ...Object.fromEntries(Object.entries(existing.meta).filter(([k]) => k !== 'tabs')), ...tree.meta, theme: themeMeta, updatedBy: AGENT_AUTHOR },
					} as TLShapePartial)
					for (const child of tree.children) this._createTree(child, id)
				} else {
					if (skeleton) editor.deleteShapes([skeleton.id])
					this._createTree(tree, undefined, { theme: themeMeta })
				}
				this._relayout(editor.getShape(id) as UiShape)
			})
		)
		const screen = editor.getShape(id) as UiShape
		this._pointAt(id)
		const warnings = this._warnings(screen)
		return {
			...this._node(screen, true),
			...(Object.keys(renamedRaw).length ? { renamedIds: renamedRaw } : {}),
			...(warnings.length ? { warnings } : {}),
		}
	}

	add_nodes(args: Args) {
		const editor = this.editor
		const parent = this._requireContainer(args.parentId)
		const specs: UiNodeSpec[] = (Array.isArray(args.nodes) ? args.nodes : args.nodes ? [args.nodes] : []).filter((n: any) => n && typeof n === 'object')
		if (!specs.length) throw new Error('nodes must be a non-empty array of node specs')
		const prefix = bare((this._screenOf(parent) ?? parent).id)
		const trees = specs.map((s) => specToTree(s.type === 'screen' ? { ...s, type: 'frame' } : s))
		const renamed: Record<string, string> = {}
		const used = new Set<string>()
		for (const t of trees) {
			if (!t.id || used.has(cleanId(t.id)) || editor.getShape(toId(t.id))) {
				const original = t.id || t.props.kind
				let candidate = `${prefix}_${cleanId(original)}`
				for (let k = 2; used.has(candidate) || editor.getShape(toId(candidate)); k++) candidate = `${prefix}_${cleanId(original)}_${k}`
				renamed[original] = candidate
				t.id = candidate
			}
			Object.assign(renamed, this._dedupeIds(t, prefix))
			used.add(cleanId(t.id))
		}
		if (!this.hooks.asUser) {
			const screen = this._screenOf(parent)
			for (const t of trees) {
				this._semanticBadges(t)
				this._nameLayers(t, screen ? { id: bare(screen.id), name: screen.props.name } : null)
			}
		}
		const existing = this._children(parent)
		const index = Number.isInteger(args.index) ? Math.max(0, Math.min(existing.length, args.index)) : existing.length
		this._act(() =>
			editor.run(() => {
				for (const t of trees) this._createTree(t, parent.id)
				const added = trees.map((t) => editor.getShape(toId(t.id)) as UiShape)
				this._setOrder([...existing.slice(0, index), ...added, ...existing.slice(index)])
				this._relayout(this._layoutRoot(parent))
			})
		)
		this._pointAt(toId(trees[0].id))
		const root = this._layoutRoot(parent)
		const warnings = root ? this._warnings(root) : []
		return {
			parentId: bare(parent.id),
			added: trees.map((t) => this._node(editor.getShape(toId(t.id)) as UiShape, true)),
			...(Object.keys(renamed).length ? { renamedIds: renamed } : {}),
			...(warnings.length ? { warnings } : {}),
		}
	}

	update_node(args: Args): Args {
		const editor = this.editor
		// A template's id ("d_stat") means every row it produced ("d_stat_1", "d_stat_2"...).
		if (!editor.getShape(toId(args.id))) {
			const prefix = `${cleanId(args.id)}_`
			const copies = editor.getCurrentPageShapes().filter((s) => isUi(s) && bare(s.id).startsWith(prefix) && /^\d+$/.test(bare(s.id).slice(prefix.length)))
			if (copies.length) return { updated: copies.map((c): Args => this.update_node({ ...args, id: bare(c.id) })) }
		}
		const shape = this._requireUi(args.id)
		let props: UiProps = { ...shape.props }
		let meta: UiMeta = this._meta(shape)
		if (args.type !== undefined && shape.props.kind !== 'screen') {
			const kind = normalizeKind(args.type)
			if (kind !== props.kind && kind !== 'screen') {
				if (!isContainerKind(kind) && this._children(shape).length) {
					throw new Error(`"${args.id}" has children; a ${kind} can't contain nodes. Move or delete its children first.`)
				}
				const d = KIND_DEFAULTS[kind]
				props = { ...props, ...d.props, ...(props.text ? { text: props.text } : {}), kind, w: props.w, h: props.h }
				meta = { ...meta, sizing: { ...d.sizing }, ...(d.layout ? { layout: meta.layout ?? d.layout } : {}) }
				if (!d.layout) delete meta.layout
			}
		}
		const patch: Partial<UiNodeSpec> = {}
		for (const k of SPEC_KEYS) if (args[k] !== undefined) (patch as any)[k] = args[k]
		const next = applySpec(props, meta, patch)
		// A status badge keeps its semantic colors when the brand changes ("use a green accent").
		if (!this.hooks.asUser && next.props.kind === 'badge') {
			const probe: UiTreeNode = { id: bare(shape.id), props: next.props, meta: next.meta, x: 0, y: 0, children: [] }
			this._semanticBadges(probe)
		}
		const parent = editor.getShape(shape.parentId as TLShapeId)
		const free = !isUi(parent) || (this._meta(parent).layout?.mode ?? 'none') === 'none'
		this._act(() =>
			editor.run(() => {
				editor.updateShape({
					id: shape.id,
					type: 'ui',
					...(free && typeof args.x === 'number' ? { x: args.x } : {}),
					...(free && typeof args.y === 'number' ? { y: args.y } : {}),
					props: next.props,
					meta: { ...shape.meta, ...next.meta },
				} as TLShapePartial)
				this._relayout(this._layoutRoot(shape))
			})
		)
		this._pointAt(shape.id)
		return this._node(editor.getShape(shape.id) as UiShape, true)
	}

	move_node(args: Args) {
		const editor = this.editor
		const shape = this._requireUi(args.id)
		if (shape.props.kind === 'screen' && args.parentId) throw new Error('Screens are top level; they cannot be moved into another node.')
		const oldParent = editor.getShape(shape.parentId as TLShapeId)
		const newParent = args.parentId ? this._requireContainer(args.parentId) : oldParent
		if (!isContainer(newParent)) throw new Error(`"${args.id}" is not inside a screen or frame; pass parentId.`)
		if (newParent.id === shape.id || editor.hasAncestor(newParent, shape.id)) throw new Error(`Can't move "${args.id}" into itself.`)
		const oldRoot = this._layoutRoot(shape)
		this._act(() =>
			editor.run(() => {
				if (newParent.id !== shape.parentId) editor.reparentShapes([shape.id], newParent.id)
				const siblings = this._children(newParent).filter((s) => s.id !== shape.id)
				const index = Number.isInteger(args.index) ? Math.max(0, Math.min(siblings.length, args.index)) : siblings.length
				siblings.splice(index, 0, editor.getShape(shape.id) as UiShape)
				this._setOrder(siblings)
				if (isContainer(oldParent) && oldParent.id !== newParent.id) this._setOrder(this._children(oldParent))
				const newRoot = this._layoutRoot(newParent)
				this._relayout(newRoot)
				if (oldRoot && oldRoot.id !== newRoot?.id) this._relayout(oldRoot)
			})
		)
		this._pointAt(shape.id)
		return {
			id: bare(shape.id),
			parentId: bare(newParent.id),
			order: this._children(newParent).map((s) => bare(s.id)),
		}
	}

	delete_nodes(args: Args) {
		const editor = this.editor
		const ids: string[] = (Array.isArray(args.ids) ? args.ids : args.id ? [args.id] : []).map(String)
		const shapes = ids.map((id) => editor.getShape(toId(id))).filter((s): s is TLShape => !!s)
		const missing = ids.filter((id) => !editor.getShape(toId(id)))
		if (!shapes.length) throw new Error(`None of those ids exist: ${ids.join(', ')}. Existing nodes: ${this._knownIds(isUi)}`)
		const doomed = new Set(editor.getShapeAndDescendantIds(shapes.map((s) => s.id)))
		const parents = [...new Set(shapes.map((s) => s.parentId as TLShapeId))]
		const roots = [...new Set(shapes.map((s) => this._layoutRoot(s)).filter((r): r is UiShape => !!r && !doomed.has(r.id)))]
		this._act(() =>
			editor.run(() => {
				this._deleteWithArrows(shapes.map((s) => s.id))
				for (const p of parents) {
					const parent = editor.getShape(p)
					if (isContainer(parent)) this._setOrder(this._children(parent))
				}
				for (const r of roots) this._relayout(editor.getShape(r.id) as UiShape)
			})
		)
		return { deleted: shapes.map((s) => bare(s.id)), ...(missing.length ? { notFound: missing } : {}) }
	}

	duplicate_screen(args: Args) {
		const editor = this.editor
		const src = this._requireScreen(args.id)
		if (!args.newId) throw new Error('duplicate_screen needs newId')
		const newId = cleanId(args.newId)
		if (editor.getShape(toId(newId))) throw new Error(`Id "${newId}" is already used. Pick another newId.`)
		const srcId = bare(src.id)
		const tree = this._toTree(src)
		const idMap: Record<string, string> = {}
		const remap = (n: UiTreeNode, isRoot: boolean) => {
			const old = n.id
			n.id = isRoot ? newId : old.startsWith(`${srcId}_`) ? `${newId}_${old.slice(srcId.length + 1)}` : `${newId}_${old}`
			if (!isRoot) idMap[old] = n.id
			n.children.forEach((c) => remap(c, false))
		}
		remap(tree, true)
		Object.assign(idMap, this._dedupeIds(tree, newId))
		tree.props.name = String(args.name ?? `${src.props.name} copy`)
		const pos = nextScreenPosition(editor, src.props.w, src.props.h)
		tree.x = pos.x
		tree.y = pos.y
		this._act(() =>
			editor.run(() => {
				this._createTree(tree, undefined, { theme: src.meta?.theme })
				this._relayout(editor.getShape(toId(newId)) as UiShape)
			})
		)
		this._pointAt(toId(newId))
		return { id: newId, name: tree.props.name, x: Math.round(pos.x), y: Math.round(pos.y), idMap }
	}

	set_theme(args: Args) {
		const editor = this.editor
		const target = args.screenId ?? args.id ?? 'all'
		const screens =
			target === 'all'
				? editor.getCurrentPageShapes().filter(isScreen)
				: [this._screenOf(this._requireUi(target)) ?? this._requireScreen(target)]
		if (!screens.length) throw new Error('There are no screens yet. Create one with create_screen.')
		if (args.mode !== undefined && args.mode !== 'light' && args.mode !== 'dark') throw new Error("mode must be 'light' or 'dark'")
		if (args.primary !== undefined && !/^#[0-9a-fA-F]{3,8}$/.test(String(args.primary))) throw new Error("primary must be a hex color like '#2563eb'")
		this._act(() =>
			editor.updateShapes(
				screens.map((s) => {
					const prev = { ...DEFAULT_THEME, ...((s.meta?.theme as object) ?? {}) }
					return {
						id: s.id,
						type: 'ui',
						meta: { ...s.meta, theme: { ...prev, ...(args.mode ? { mode: args.mode } : {}), ...(args.primary ? { primary: args.primary } : {}) } },
					} as TLShapePartial
				})
			)
		)
		return { screens: screens.map((s) => ({ id: bare(s.id), theme: (editor.getShape(s.id)!.meta as any).theme })) }
	}

	connect_screens(args: Args) {
		const from = this._require(args.fromId)
		const to = this._require(args.toId)
		if (from.id === to.id) throw new Error('fromId and toId must differ')
		const id = toId(args.id ?? `flow_${bare(from.id)}_${bare(to.id)}`)
		// Leave from the side of the node facing the destination, enter the screen's near edge.
		const fb = this.editor.getShapePageBounds(from)!
		const tb = this.editor.getShapePageBounds(to)!
		const rightward = tb.center.x >= fb.center.x
		// Enter the destination level with the source when it can, so the flow reads as a straight line.
		const endY = Math.min(0.9, Math.max(0.1, (fb.center.y - tb.y) / Math.max(1, tb.h)))
		// Put the label in the gap between the two screens, not over the source screen's edge.
		const fromScreen = this._screenOf(from)
		const sb = fromScreen && fromScreen.id !== from.id ? this.editor.getShapePageBounds(fromScreen) : null
		const x0 = rightward ? fb.maxX : fb.x
		const x1 = rightward ? tb.x : tb.maxX
		const gapMid = sb ? (rightward ? (sb.maxX + tb.x) / 2 : (sb.x + tb.maxX) / 2) : (x0 + x1) / 2
		const labelPosition = Math.abs(x1 - x0) > 1 ? Math.min(0.9, Math.max(0.1, (gapMid - x0) / (x1 - x0))) : 0.5
		this._act(() =>
			this._arrow(
				id,
				from,
				to,
				{ richText: toRichText(String(args.label ?? '')), color: 'blue', size: 's', font: 'sans', labelPosition },
				agentMeta({ role: 'flow' }),
				{ start: { x: rightward ? 1 : 0, y: 0.5 }, end: { x: rightward ? 0 : 1, y: endY } }
			)
		)
		this._pointAt(to.id)
		return { id: bare(id), fromId: bare(from.id), toId: bare(to.id) }
	}

	focus_view(args: Args) {
		const editor = this.editor
		const ids: string[] = Array.isArray(args.shapeIds) ? args.shapeIds : []
		const bounds = unionBounds(editor, ids.map((id) => editor.getShape(toId(id))))
		if (!bounds) throw new Error(`None of those shapes exist. Screens: ${this._knownIds(isScreen)}`)
		const zoom = Number(args.zoomLevel)
		// Fit above the floating voice dock so the bottom of the screen stays visible.
		fitBounds(editor, bounds, { inset: 64, ...(zoom > 0 ? { targetZoom: zoom, maxZoom: zoom } : {}) })
		return { focused: ids }
	}

	clear_canvas(args: Args) {
		const editor = this.editor
		let shapes: TLShape[]
		if (args.mode === 'agent_only') {
			shapes = editor.getCurrentPageShapes().filter((s) => authorOf(s)?.kind === 'agent')
		} else if (Array.isArray(args.ids) && args.ids.length) {
			shapes = args.ids.map((id: string) => editor.getShape(toId(id))).filter((s: TLShape | undefined): s is TLShape => !!s)
		} else if (args.mode === 'selection') {
			shapes = editor.getSelectedShapes()
		} else {
			shapes = editor.getCurrentPageShapes()
		}
		this._act(() => this._deleteWithArrows(shapes.map((s) => s.id)))
		return { deleted: shapes.length }
	}

	// -------------------------------------------------------- reading tools

	get_canvas_state(args: Args) {
		const editor = this.editor
		let shapes = this._scopeShapes(args)
		if (args.author === 'user' || args.author === 'agent') {
			shapes = shapes.filter((s) => (authorOf(s)?.kind ?? 'user') === args.author)
		}
		const explicit = Array.isArray(args.shapeIds) && args.shapeIds.length > 0
		const inScope = new Set(shapes.map((s) => s.id))
		// Design nodes come back as nested trees: the topmost in-scope ui shapes.
		const uiRoots = shapes.filter((s) => {
			if (!isUi(s)) return false
			if (explicit) return true
			let p = editor.getShape(s.parentId as TLShapeId)
			while (p) {
				if (isUi(p) && inScope.has(p.id)) return false
				p = editor.getShape(p.parentId as TLShapeId)
			}
			return true
		}) as UiShape[]
		const screens = uiRoots.map((s) => this._node(s))
		const others = shapes.filter((s) => !isUi(s)).map((s) => this._serialize(s))
		const limit = 200
		const audited = args.audit ? [...new Set(uiRoots.map((s) => this._screenOf(s)).filter((s): s is UiShape => !!s))] : []
		return {
			screens,
			...(args.audit ? { audit: audited.flatMap((s) => this._audit(s)) } : {}),
			...(others.length ? { shapes: others.slice(0, limit) } : {}),
			...(others.length > limit ? { truncated: true } : {}),
			viewport: (() => {
				const v = editor.getViewportPageBounds()
				return { x: Math.round(v.x), y: Math.round(v.y), w: Math.round(v.w), h: Math.round(v.h) }
			})(),
		}
	}

	async get_canvas_image(args: Args): Promise<ToolResult> {
		const editor = this.editor
		const shapes = this._scopeShapes(args)
		if (!shapes.length) return { ok: false, error: 'There is nothing on the canvas in that area.' }
		const bounds = unionBounds(editor, shapes)!
		const MAX = 1600
		const scale = Math.min(Number(args.scale) || 1, MAX / Math.max(bounds.w + 64, bounds.h + 64, 1))
		const { blob, width, height } = await editor.toImage(shapes, { format: 'png', background: true, padding: 32, scale, pixelRatio: 1 })
		const image = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader()
			reader.onload = () => resolve(reader.result as string)
			reader.onerror = () => reject(reader.error)
			reader.readAsDataURL(blob)
		})
		return {
			ok: true,
			image,
			data: { width, height, pageBounds: { x: Math.round(bounds.x), y: Math.round(bounds.y), w: Math.round(bounds.w), h: Math.round(bounds.h) } },
		}
	}

	get_participants() {
		const editor = this.editor
		const now = Date.now()
		const others = editor.getCollaborators().map((c) => ({
			name: c.userName,
			color: c.color,
			cursor: c.cursor ? { x: Math.round(c.cursor.x), y: Math.round(c.cursor.y) } : null,
			selection: c.selectedShapeIds.map(bare),
			activelyDrawing: !!c.lastActivityTimestamp && now - c.lastActivityTimestamp < 3000,
		}))
		return { participants: [{ name: editor.user.getName(), self: true, selection: editor.getSelectedShapeIds().map(bare) }, ...others] }
	}

	// ------------------------------------------------------ feedback tools

	highlight_shapes(args: Args) {
		const editor = this.editor
		const targets = (Array.isArray(args.shapeIds) ? args.shapeIds : []).map((id: string) => editor.getShape(toId(id)))
		const bounds = unionBounds(editor, targets)
		if (!bounds) throw new Error(`None of those shapes exist. Nodes: ${this._knownIds(isUi)}`)
		const id = toId(args.id)
		const style = args.style ?? 'outline'
		// A thin outline 6px outside the node (never on its text), in the tone of the feedback.
		const pad = 6
		const box =
			style === 'underline'
				? new Box(bounds.x, bounds.maxY + 4, bounds.w, 4)
				: new Box(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2)
		this._act(() => {
			if (editor.getShape(id)) editor.deleteShapes([id])
			editor.createShape({
				id,
				type: 'critique',
				x: box.x,
				y: box.y,
				meta: agentMeta({ role: 'annotation', targets: args.shapeIds }),
				props: { kind: 'highlight', w: box.w, h: box.h, tone: toneOf(args.color ?? 'red'), to: '', scale: 1, richText: toRichText('') },
			} as any)
		})
		this._point(box.maxX + 4, box.maxY + 4)
		return { id: bare(id), highlighted: targets.filter(Boolean).length }
	}

	async add_comment(args: Args) {
		const editor = this.editor
		// The note sizes itself to its text on create: measure with the real font, not a fallback.
		if (typeof document !== 'undefined') await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 800))])
		const id = toId(args.id)
		const target = args.targetShapeId ? editor.getShape(toId(args.targetShapeId)) : undefined
		if (args.targetShapeId && !target) throw new Error(`No shape with id "${args.targetShapeId}". Nodes: ${this._knownIds(isUi)}`)
		// Comments sit beside their screen (right, left, below, above), level with the node,
		// readable at the current zoom, clear of screens, their name labels and other notes,
		// and placed so the connector to the node is short and crosses no other screen.
		const screen = target ? this._screenOf(target) : null
		const tb = target ? editor.getShapePageBounds(target) : null
		const sb = screen ? editor.getShapePageBounds(screen) : tb
		const zoom = editor.getZoomLevel()
		// Readable when zoomed out to fit several screens (13px text stays ~10px+ on screen), capped so a note never dwarfs a phone.
		const scale = Math.min(2.8, Math.max(1, 0.85 / Math.max(zoom, 0.05)))
		const view = editor.getViewportPageBounds()
		// Feedback on a collaborator's node is addressed to them even if the model forgot to say so.
		const targetAuthor = target ? authorOf(target) : null
		const to = String(args.addressedTo ?? '').replace(/^@/, '').trim() || (targetAuthor?.kind === 'user' ? targetAuthor.name : '')
		const body = String(args.text ?? '').trim().slice(0, 160)
		// Measurable claims (overflow, clipping, contrast, tap targets...) must match what the audit measured.
		if (args.kind !== 'praise') {
			const screens = screen ? [screen] : editor.getCurrentPageShapes().filter(isScreen)
			const claim = unsupportedClaim(body, screens.flatMap((s) => this._audit(s)))
			if (claim) {
				throw new Error(`Not added: the comment claims "${claim}", but measuring ${screen ? `"${bare(screen.id)}"` : 'the screens'} found no such problem (see the audit). Comment only on measured issues, or on hierarchy, copy and content.`)
			}
		}
		const text = to && !body.startsWith(`@${to}`) ? `@${to} ${body}` : body
		// A left-aligned card sized to its text: header (tone + addressee) over the comment.
		const M = NOTE_METRICS
		const W = M.width * scale
		const lines = measureTextDom(body, M.fontSize, M.width - M.padX * 2 - M.rule, 400).h / (M.fontSize * LINE_HEIGHT)
		const H = Math.ceil((M.padY * 2 + M.headerH + M.gap + Math.max(1, Math.round(lines)) * M.fontSize * M.lineHeight + 4) * scale)
		const pos = this._commentSpot(id, target ?? null, tb ?? null, sb ?? null, W, H, view)
		const leader = createShapeId(`${bare(id)}_leader`)
		this._act(() => {
			for (const old of [id, leader]) if (editor.getShape(old)) editor.deleteShapes([old])
			editor.createShape({
				id,
				type: 'critique',
				x: pos.x,
				y: pos.y,
				meta: agentMeta({ role: 'comment', kind: args.kind }),
				props: { kind: 'note', w: W, h: H, tone: toneOf(args.kind), to, scale, richText: toRichText(text) },
			} as any)
			if (target) {
				this._arrow(leader, editor.getShape(id)!, target, { color: 'grey', dash: 'solid', size: 's', arrowheadEnd: 'dot', arrowheadStart: 'none' }, agentMeta({ role: 'annotation' }))
			}
		})
		// Park the cursor below the card's corner, never on its text.
		this._point(pos.x + W + 6, pos.y + H + 6)
		return { id: bare(id), x: Math.round(pos.x), y: Math.round(pos.y) }
	}
}

/** True when the segment a-b passes through box o. */
function segmentHitsBox(a: { x: number; y: number }, b: { x: number; y: number }, o: Box): boolean {
	// Sample the segment: boxes are screens, far larger than the step.
	const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 12)
	for (let i = 0; i <= n; i++) {
		const t = n ? i / n : 0
		const x = a.x + (b.x - a.x) * t
		const y = a.y + (b.y - a.y) * t
		if (x > o.x && x < o.maxX && y > o.y && y < o.maxY) return true
	}
	return false
}

/**
 * Client-side version of the server's guard, for live voice mode (whose tool
 * calls don't pass through the server): returns a permission prompt when a
 * call would change or erase a user's shapes.
 */
export function studentWorkPrompt(editor: Editor, name: string, args: Args): string | null {
	const student = (ids: string[]) =>
		ids.map((id) => editor.getShape(toId(id))).filter((s): s is TLShape => !!s && authorOf(s)?.kind !== 'agent')
	let touched: TLShape[] = []
	let verb = 'change'
	if (['update_node', 'move_node', 'create_screen', 'duplicate_screen'].includes(name)) touched = student([String(args.id ?? '')])
	else if (name === 'add_nodes') touched = student([String(args.parentId ?? '')])
	else if (name === 'set_theme' && args.screenId && args.screenId !== 'all') touched = student([String(args.screenId)])
	else if (name === 'delete_nodes') {
		verb = 'delete'
		touched = student(Array.isArray(args.ids) ? args.ids.map(String) : [])
	} else if (name === 'clear_canvas' && args.mode !== 'agent_only') {
		verb = 'erase'
		touched = Array.isArray(args.ids) && args.ids.length
			? student(args.ids.map(String))
			: args.mode === 'selection'
				? editor.getSelectedShapes().filter((s) => authorOf(s)?.kind !== 'agent')
				: editor.getCurrentPageShapes().filter((s) => authorOf(s)?.kind !== 'agent')
	}
	if (!touched.length) return null
	const owners = [...new Set(touched.map((s) => authorOf(s)?.name ?? 'a user'))].join(', ')
	return `${AGENT_NAME} wants to ${verb} ${touched.length} element(s) made by ${owners}. Allow?`
}

// Suggestions (dashed overlays) belonged to the whiteboard tutor; the design
// tool edits directly. These stay so the panel's (now empty) suggestion list compiles.

/** Accept a suggestion: make it solid and hand ownership to the user who accepted it. */
export function acceptSuggestion(editor: Editor, suggestionId: string, author: Author) {
	const shapes = editor.getCurrentPageShapes().filter((s) => (s.meta?.suggestion as any)?.id === suggestionId)
	if (!shapes.length) return
	editor.run(() => {
		editor.updateShapes(
			shapes.map((s) => {
				const { suggestion: _drop, ...meta } = s.meta as Args
				return { id: s.id, type: s.type, opacity: 1, meta: { ...meta, author } } as TLShapePartial
			})
		)
	})
}

export function dismissSuggestion(editor: Editor, suggestionId: string) {
	const ids = editor
		.getCurrentPageShapes()
		.filter((s) => (s.meta?.suggestion as any)?.id === suggestionId)
		.map((s) => s.id)
	if (ids.length) editor.deleteShapes(ids)
}
