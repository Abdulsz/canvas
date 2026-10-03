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
import type { Author, ToolResult } from '../../../shared/protocol.ts'
import { AGENT_AUTHOR, asAgent, authorOf } from './authorship.ts'
import { findFreeSpot, unionBounds } from './layout.ts'

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

const agentMeta = (extra: Args = {}) => ({ author: AGENT_AUTHOR, ...extra })

export type ExecutorHooks = {
	/** Where the agent "is" on the canvas, for its presence cursor. */
	onAgentCursor?: (x: number, y: number) => void
}

/**
 * Applies Grok's tool calls to the tldraw editor. Edits go into the synced
 * store, so every student in the room sees them.
 */
export class CanvasExecutor {
	constructor(
		private editor: Editor,
		private hooks: ExecutorHooks = {}
	) {}

	async run(name: string, args: Args): Promise<ToolResult> {
		try {
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

	private _label(shape: TLShape): string {
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

	private _require(id: unknown): TLShape {
		const shape = this.editor.getShape(toId(id))
		if (!shape) {
			const known = this.editor
				.getCurrentPageShapes()
				.slice(0, 40)
				.map((s) => bare(s.id))
			throw new Error(`No shape with id "${id}". Existing ids: ${known.join(', ') || '(board is empty)'}`)
		}
		return shape
	}

	private _deleteWithArrows(ids: TLShapeId[]) {
		if (ids.length) this.editor.deleteShapes(ids)
	}

	/** Creates (or recreates) an arrow bound to two shapes. */
	private _arrow(id: TLShapeId, from: TLShape, to: TLShape, props: Args, meta: Args) {
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
		const binding = (terminal: 'start' | 'end', target: TLShape) => ({
			type: 'arrow' as const,
			fromId: id,
			toId: target.id,
			props: { terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' as const },
		})
		editor.createBindings<TLArrowBinding>([binding('start', from), binding('end', to)])
	}

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
		if (shape.meta?.suggestion) out.suggestion = true
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

	// ------------------------------------------------------- drawing tools

	create_shape(args: Args) {
		const editor = this.editor
		const id = toId(args.id)
		const type = ['geo', 'text', 'note'].includes(args.type) ? args.type : 'geo'
		const w = Number(args.w) || (type === 'note' ? 200 : 160)
		const h = Number(args.h) || (type === 'note' ? 200 : 80)
		const existing = editor.getShape(id)
		const pos =
			existing && existing.type === type
				? { x: Number(args.x ?? existing.x), y: Number(args.y ?? existing.y), nudged: false }
				: findFreeSpot(editor, new Box(Number(args.x) || 0, Number(args.y) || 0, w, h))
		const richText = toRichText(String(args.label ?? ''))
		const c = color(args.color)
		const props: Args =
			type === 'geo'
				? { geo: ['rectangle', 'ellipse', 'diamond'].includes(args.geo) ? args.geo : 'rectangle', w, h, richText, color: c, fill: 'semi', size: 's' }
				: type === 'note'
					? { richText, color: args.color ? c : 'yellow', size: 's' }
					: { richText, color: c, size: 's' }

		asAgent(() => {
			if (existing && existing.type === type) {
				editor.updateShape({ id, type, x: pos.x, y: pos.y, props })
			} else {
				if (existing) editor.deleteShapes([id])
				editor.createShape({ id, type, x: pos.x, y: pos.y, props, meta: agentMeta() })
			}
		})
		this._pointAt(id)
		const b = editor.getShapePageBounds(id)!
		return { id: bare(id), x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h), nudged: pos.nudged }
	}

	create_arrow(args: Args) {
		const from = this._require(args.fromId)
		const to = this._require(args.toId)
		const id = toId(args.id)
		asAgent(() =>
			this._arrow(
				id,
				from,
				to,
				{ richText: toRichText(String(args.label ?? '')), color: color(args.color, 'grey'), size: 's' },
				agentMeta()
			)
		)
		this._pointAt(to.id)
		return { id: bare(id), fromId: bare(from.id), toId: bare(to.id) }
	}

	draw_array(args: Args) {
		const editor = this.editor
		const group = String(args.id ?? 'array')
		const values: string[] = (Array.isArray(args.values) ? args.values : []).map(String)
		if (!values.length) throw new Error('values must be a non-empty array')
		const CELL = 64
		const previous = editor.getCurrentPageShapes().filter((s) => s.meta?.group === group && authorOf(s)?.kind === 'agent')
		const origin = (previous[0]?.meta?.origin as { x: number; y: number } | undefined) ??
			findFreeSpot(editor, new Box(Number(args.startX) || 0, (Number(args.startY) || 0) - 110, values.length * CELL, CELL + 150))
		const x0 = origin.x
		const y0 = previous.length ? origin.y : origin.y + 110
		const highlight = new Set<number>(Array.isArray(args.highlight) ? args.highlight : [])
		const meta = agentMeta({ group, origin: { x: x0, y: y0 } })
		const sid = (part: string) => createShapeId(`${group.replace(/[^a-zA-Z0-9_-]/g, '_')}_${part}`)

		asAgent(() => {
			this._deleteWithArrows(previous.map((s) => s.id))
			editor.createShapes(
				values.flatMap((v, i) => [
					{
						id: sid(`cell_${i}`),
						type: 'geo',
						x: x0 + i * CELL,
						y: y0,
						meta,
						props: {
							geo: 'rectangle',
							w: CELL,
							h: CELL,
							richText: toRichText(v),
							color: highlight.has(i) ? 'orange' : 'black',
							fill: highlight.has(i) ? 'semi' : 'none',
							size: 's',
						},
					},
					{
						id: sid(`idx_${i}`),
						type: 'text',
						x: x0 + i * CELL + CELL / 2 - 6,
						y: y0 + CELL + 6,
						meta,
						props: { richText: toRichText(String(i)), color: 'grey', size: 's' },
					},
				])
			)
			// Group pointers that share an index into one marker ("left/right").
			const byIndex = new Map<number, string[]>()
			for (const p of Array.isArray(args.pointers) ? args.pointers : []) {
				const i = Number(p?.index)
				if (!Number.isInteger(i) || i < 0 || i >= values.length) continue
				byIndex.set(i, [...(byIndex.get(i) ?? []), String(p.label ?? '^')])
			}
			const palette = ['red', 'blue', 'green', 'violet'] as const
			let k = 0
			for (const [i, labels] of byIndex) {
				const cx = x0 + i * CELL + CELL / 2
				const c = palette[k++ % palette.length]
				editor.createShapes([
					{
						id: sid(`ptr_${i}_label`),
						type: 'text',
						x: cx - 8 * labels.join('/').length,
						y: y0 - 100,
						meta,
						props: { richText: toRichText(labels.join('/')), color: c, size: 's' },
					},
					{
						id: sid(`ptr_${i}_arrow`),
						type: 'arrow',
						x: cx,
						y: y0 - 62,
						meta,
						props: { start: { x: 0, y: 0 }, end: { x: 0, y: 56 }, color: c, size: 's' },
					},
				])
			}
		})
		this._point(x0 + (values.length * CELL) / 2, y0 - 40)
		return { id: group, x: Math.round(x0), y: Math.round(y0), w: values.length * CELL, h: CELL, cellIds: values.map((_, i) => bare(sid(`cell_${i}`))) }
	}

	update_shape(args: Args) {
		const editor = this.editor
		const shape = this._require(args.id)
		const props: Args = {}
		if (args.label !== undefined && 'richText' in (shape.props as any)) props.richText = toRichText(String(args.label))
		if (args.color !== undefined && 'color' in (shape.props as any)) props.color = color(args.color)
		asAgent(() =>
			editor.updateShape({
				id: shape.id,
				type: shape.type,
				...(typeof args.x === 'number' ? { x: args.x } : {}),
				...(typeof args.y === 'number' ? { y: args.y } : {}),
				props,
			})
		)
		this._pointAt(shape.id)
		return this._serialize(editor.getShape(shape.id)!)
	}

	focus_view(args: Args) {
		const editor = this.editor
		const ids: string[] = Array.isArray(args.shapeIds) ? args.shapeIds : []
		const bounds = unionBounds(editor, ids.map((id) => editor.getShape(toId(id))))
		if (!bounds) throw new Error('None of those shapes exist.')
		const zoom = Number(args.zoomLevel)
		editor.zoomToBounds(bounds, {
			inset: 80,
			animation: { duration: 400 },
			...(zoom > 0 && zoom !== 1 ? { targetZoom: zoom } : {}),
		})
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
		asAgent(() => this._deleteWithArrows(shapes.map((s) => s.id)))
		return { deleted: shapes.length }
	}

	// -------------------------------------------------------- reading tools

	get_canvas_state(args: Args) {
		let shapes = this._scopeShapes(args)
		if (args.author === 'user' || args.author === 'agent') {
			shapes = shapes.filter((s) => (authorOf(s)?.kind ?? 'user') === args.author)
		}
		const all = shapes.map((s) => this._serialize(s))
		const limit = 200
		return {
			count: all.length,
			shapes: all.slice(0, limit),
			...(all.length > limit ? { truncated: true } : {}),
			viewport: (() => {
				const v = this.editor.getViewportPageBounds()
				return { x: Math.round(v.x), y: Math.round(v.y), w: Math.round(v.w), h: Math.round(v.h) }
			})(),
		}
	}

	async get_canvas_image(args: Args): Promise<ToolResult> {
		const editor = this.editor
		const shapes = this._scopeShapes(args)
		if (!shapes.length) return { ok: false, error: 'There is nothing on the board in that area.' }
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
		if (!bounds) throw new Error('None of those shapes exist.')
		const id = toId(args.id)
		const style = args.style ?? 'outline'
		const c = color(args.color, 'red')
		const pad = style === 'circle' ? 36 : 16
		const box =
			style === 'underline'
				? new Box(bounds.x, bounds.maxY + 8, bounds.w, 8)
				: new Box(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2)
		asAgent(() => {
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
					size: 'm',
				},
			})
			editor.sendToBack([id])
		})
		this._point(box.maxX, box.y)
		return { id: bare(id), highlighted: targets.filter(Boolean).length }
	}

	add_comment(args: Args) {
		const editor = this.editor
		const id = toId(args.id)
		const target = args.targetShapeId ? editor.getShape(toId(args.targetShapeId)) : undefined
		const tb = target ? editor.getShapePageBounds(target) : null
		const NOTE = 200
		const center = editor.getViewportPageBounds().center
		const rect = tb ? new Box(tb.maxX + 80, tb.y, NOTE, NOTE) : new Box(center.x - NOTE / 2, center.y - NOTE / 2, NOTE, NOTE)
		const ignore = new Set<string>([id, ...(target ? [target.id] : [])])
		const pos = findFreeSpot(editor, rect, { avoidAll: true, ignore })
		const kindColor: Record<string, TLDefaultColorStyle> = { error: 'light-red', hint: 'yellow', praise: 'light-green', question: 'light-blue' }
		const text = args.addressedTo ? `@${args.addressedTo} ${args.text ?? ''}` : String(args.text ?? '')
		const leader = createShapeId(`${bare(id)}_leader`)
		asAgent(() => {
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

	suggest_correction(args: Args) {
		const editor = this.editor
		const entries: Args[] = Array.isArray(args.shapes) ? args.shapes : []
		if (!entries.length) throw new Error('shapes must be a non-empty array')
		const suggestion = { id: String(args.id ?? 'suggestion'), explanation: String(args.explanation ?? ''), forShapeIds: args.forShapeIds ?? [] }
		const boxes = entries.filter((e) => !e.fromId).map((e) => new Box(Number(e.x) || 0, Number(e.y) || 0, Number(e.w) || 160, Number(e.h) || 80))
		// Shift the whole suggestion (keeping its internal layout) off of student work.
		let dx = 0
		let dy = 0
		if (boxes.length) {
			const group = Box.Common(boxes)
			const spot = findFreeSpot(editor, group)
			dx = spot.x - group.x
			dy = spot.y - group.y
		}
		const created: string[] = []
		asAgent(() => {
			for (const e of entries.filter((e) => !e.fromId)) {
				const r = this.create_shape({ ...e, x: (Number(e.x) || 0) + dx, y: (Number(e.y) || 0) + dy })
				created.push(r.id)
			}
			for (const e of entries.filter((e) => e.fromId && e.toId)) {
				created.push(this.create_arrow({ ...e, id: e.id ?? `${suggestion.id}_${created.length}` }).id)
			}
			if (suggestion.explanation) {
				const b = unionBounds(editor, created.map((id) => editor.getShape(toId(id))))
				if (b) {
					const label = this.create_shape({
						id: `${suggestion.id}_label`,
						type: 'text',
						x: b.x,
						y: b.y - 48,
						label: `Suggestion: ${suggestion.explanation}`,
						color: 'violet',
					})
					created.push(label.id)
				}
			}
			editor.updateShapes(
				created.map((id) => {
					const s = editor.getShape(toId(id))!
					return {
						id: s.id,
						type: s.type,
						opacity: 0.55,
						meta: { ...s.meta, suggestion },
						...('dash' in (s.props as any) ? { props: { dash: 'dashed' } } : {}),
					} as TLShapePartial
				})
			)
		})
		return { id: suggestion.id, shapeIds: created, offset: { dx, dy } }
	}
}

/** Accept a suggestion: make it solid and hand ownership to the student who accepted it. */
export function acceptSuggestion(editor: Editor, suggestionId: string, author: Author) {
	const shapes = editor.getCurrentPageShapes().filter((s) => (s.meta?.suggestion as any)?.id === suggestionId)
	const label = shapes.filter((s) => s.id.endsWith('_label'))
	editor.run(() => {
		editor.deleteShapes(label.map((s) => s.id))
		editor.updateShapes(
			shapes
				.filter((s) => !label.includes(s))
				.map((s) => {
					const { suggestion: _drop, ...meta } = s.meta as Args
					return { id: s.id, type: s.type, opacity: 1, meta: { ...meta, author }, ...('dash' in (s.props as any) ? { props: { dash: 'draw' } } : {}) } as TLShapePartial
				})
		)
	})
}

export function dismissSuggestion(editor: Editor, suggestionId: string) {
	const ids = editor
		.getCurrentPageShapes()
		.filter((s) => (s.meta?.suggestion as any)?.id === suggestionId)
		.map((s) => s.id)
	editor.deleteShapes(ids)
}
