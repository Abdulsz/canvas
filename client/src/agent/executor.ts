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
import {
	applySpec,
	DEFAULT_THEME,
	DEVICES,
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
} from '../../../shared/design.ts'
import { AGENT_NAME, type Author, type ToolResult } from '../../../shared/protocol.ts'
import { measureTextDom } from '../design/measure.ts'
import { readUiTree, uiChildren, uiMeta } from '../design/tree.ts'
import type { UiShape } from '../design/UiShapeUtil.tsx'
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

	private _pointAt(id: TLShapeId) {
		const b = this.editor.getShapePageBounds(id)
		if (b) this._point(b.center.x, b.center.y)
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

	/** Re-runs auto layout on a screen/root and writes back the changed boxes. */
	private _relayout(root: UiShape | null) {
		if (!root || !this.editor.getShape(root.id)) return
		const editor = this.editor
		const tree = this._toTree(editor.getShape(root.id) as UiShape)
		const boxes = layoutTree(toLayoutNode(tree), { measure: measureTextDom })
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
		if (p.name && p.name !== out.id) out.name = p.name
		if (p.text) out.text = p.text
		if (p.icon && ['icon', 'button', 'input', 'avatar', 'image'].includes(p.kind) && (p.kind !== 'icon' || p.icon !== d.props.icon)) out.icon = p.icon
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
			if (['text', 'button', 'input', 'checkbox', 'avatar'].includes(p.kind)) {
				if (p.fontSize !== dp.fontSize) out.fontSize = p.fontSize
				if (p.fontWeight !== dp.fontWeight) out.fontWeight = p.fontWeight
			} else delete out.align
			if (['icon', 'image', 'rect', 'toggle', 'divider', 'screen', 'frame'].includes(p.kind)) delete out.textColor
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
			}
			const author = authorOf(shape)
			if (author?.kind === 'user') out.author = { kind: author.kind, name: author.name }
		}
		const children = this._children(shape)
		const auto = isContainerKind(p.kind) && (m.layout?.mode ?? 'none') !== 'none'
		if (children.length) out.children = children.map((c) => this._node(c, brief, auto))
		return out
	}

	/** Warnings about content that doesn't fit, so the model can fix it. */
	private _warnings(root: UiShape): string[] {
		const warnings: string[] = []
		const walk = (s: UiShape) => {
			const kids = this._children(s)
			if (isContainerKind(s.props.kind) && kids.length) {
				const bottom = Math.max(...kids.map((k) => k.y + k.props.h))
				const right = Math.max(...kids.map((k) => k.x + k.props.w))
				if (bottom > s.props.h + 1) warnings.push(`Content of "${bare(s.id)}" overflows its height by ${Math.round(bottom - s.props.h)}px (clipped). Reduce content/gaps or make it taller.`)
				if (right > s.props.w + 1) warnings.push(`Content of "${bare(s.id)}" overflows its width by ${Math.round(right - s.props.w)}px (clipped).`)
				for (const k of kids) if (k.props.w < 1 && k.props.kind !== 'divider') warnings.push(`"${bare(k.id)}" has no room (width 0) in its row.`)
			}
			kids.forEach(walk)
		}
		walk(root)
		return warnings.slice(0, 8)
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

	create_screen(args: Args) {
		const editor = this.editor
		if (!args.id) throw new Error('create_screen needs an id')
		const id = toId(args.id)
		const existing = editor.getShape(id)
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
		const latest = editor.getCurrentPageShapesSorted().filter(isScreen).at(-1)
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
					: nextScreenPosition(editor, w, h)
		tree.x = pos.x
		tree.y = pos.y
		const replaceable = new Set(existing ? editor.getShapeAndDescendantIds([existing.id]) : [])
		const renamedRaw = this._dedupeIds(tree, bare(id), new Set([...replaceable].map(bare)))

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
						meta: { ...existing.meta, ...tree.meta, theme: themeMeta, updatedBy: AGENT_AUTHOR },
					} as TLShapePartial)
					for (const child of tree.children) this._createTree(child, id)
				} else {
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

	update_node(args: Args) {
		const editor = this.editor
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
		return {
			screens,
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
		const { blob, width, height } = await editor.toImage(shapes, { format: 'png', background: true, padding: 32, scale })
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
		const c = color(args.color, 'red')
		const pad = style === 'circle' ? 24 : 8
		const box =
			style === 'underline'
				? new Box(bounds.x, bounds.maxY + 6, bounds.w, 6)
				: new Box(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2)
		this._act(() => {
			if (editor.getShape(id)) editor.deleteShapes([id])
			editor.createShape({
				id,
				type: 'geo',
				x: box.x,
				y: box.y,
				meta: agentMeta({ role: 'annotation', targets: args.shapeIds }),
				props: {
					geo: style === 'circle' ? 'ellipse' : 'rectangle',
					w: box.w,
					h: box.h,
					color: c,
					fill: style === 'underline' ? 'solid' : 'none',
					dash: style === 'outline' ? 'dashed' : 'draw',
					size: 's',
				},
			})
		})
		this._point(box.maxX, box.y)
		return { id: bare(id), highlighted: targets.filter(Boolean).length }
	}

	add_comment(args: Args) {
		const editor = this.editor
		const id = toId(args.id)
		const target = args.targetShapeId ? editor.getShape(toId(args.targetShapeId)) : undefined
		if (args.targetShapeId && !target) throw new Error(`No shape with id "${args.targetShapeId}". Nodes: ${this._knownIds(isUi)}`)
		// Comments sit outside the screen, to the right of the node's screen.
		const screen = target ? this._screenOf(target) : null
		const tb = target ? editor.getShapePageBounds(target) : null
		const sb = screen ? editor.getShapePageBounds(screen) : tb
		const NOTE = 200
		const center = editor.getViewportPageBounds().center
		const rect = tb && sb ? new Box(sb.maxX + 60, tb.y, NOTE, NOTE) : new Box(center.x - NOTE / 2, center.y - NOTE / 2, NOTE, NOTE)
		const ignore = new Set<string>([id, ...(target ? [target.id] : [])])
		const pos = findFreeSpot(editor, rect, { avoidAll: true, ignore })
		const kindColor: Record<string, TLDefaultColorStyle> = {
			issue: 'light-red',
			suggestion: 'yellow',
			praise: 'light-green',
			question: 'light-blue',
			error: 'light-red',
			hint: 'yellow',
		}
		// Feedback on a collaborator's node is addressed to them even if the model forgot to say so.
		const targetAuthor = target ? authorOf(target) : null
		const to = String(args.addressedTo ?? '').replace(/^@/, '').trim() || (targetAuthor?.kind === 'user' ? targetAuthor.name : '')
		const body = String(args.text ?? '')
		const text = to && !body.startsWith(`@${to}`) ? `@${to} ${body}` : body
		const leader = createShapeId(`${bare(id)}_leader`)
		this._act(() => {
			for (const old of [id, leader]) if (editor.getShape(old)) editor.deleteShapes([old])
			editor.createShape({
				id,
				type: 'note',
				x: pos.x,
				y: pos.y,
				meta: agentMeta({ role: 'comment', kind: args.kind }),
				props: { richText: toRichText(text), color: kindColor[args.kind] ?? 'yellow', size: 's' },
			})
			if (target) {
				this._arrow(leader, editor.getShape(id)!, target, { color: 'grey', dash: 'dotted', size: 's' }, agentMeta({ role: 'annotation' }))
			}
		})
		this._pointAt(id)
		return { id: bare(id), x: Math.round(pos.x), y: Math.round(pos.y) }
	}
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
