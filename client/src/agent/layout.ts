import { Box, type Editor, type TLShape } from 'tldraw'
import { authorOf } from './authorship.ts'

type Obstacles = { avoidAll?: boolean; ignore?: Set<string> }

function obstacleBoxes(editor: Editor, opts: Obstacles): Box[] {
	const boxes: Box[] = []
	for (const shape of editor.getCurrentPageShapes()) {
		if (opts.ignore?.has(shape.id)) continue
		if (!opts.avoidAll && authorOf(shape)?.kind === 'agent') continue
		const b = editor.getShapePageBounds(shape)
		if (!b) continue
		const box = b.clone().expandBy(20)
		// A screen's name label sits just above it: keep that clear too.
		if (shape.type === 'ui' && (shape.props as { kind?: string }).kind === 'screen') {
			box.y -= 28
			box.h += 28
		}
		boxes.push(box)
	}
	// Keep clear of where other students are working right now.
	const now = Date.now()
	for (const c of editor.getCollaborators()) {
		if (!c.cursor || !c.lastActivityTimestamp || now - c.lastActivityTimestamp > 5000) continue
		boxes.push(new Box(c.cursor.x - 120, c.cursor.y - 120, 240, 240))
	}
	return boxes
}

const collides = (a: Box, boxes: Box[]) => boxes.some((b) => Box.Collides(a, b))

/**
 * Returns the requested rectangle if it is free, otherwise the nearest free
 * position found by searching outward in rings. By default only student work
 * (and active cursors) count as obstacles, since the agent lays out its own
 * shapes deliberately.
 */
export function findFreeSpot(editor: Editor, rect: Box, opts: Obstacles = {}): { x: number; y: number; nudged: boolean } {
	const boxes = obstacleBoxes(editor, opts)
	if (!collides(rect, boxes)) return { x: rect.x, y: rect.y, nudged: false }
	const step = 40
	for (let ring = 1; ring <= 60; ring++) {
		const d = ring * step
		const candidates: [number, number][] = []
		for (let t = -d; t <= d; t += step) {
			candidates.push([t, -d], [t, d], [-d, t], [d, t])
		}
		// Prefer moving right/down (reading order), then by distance.
		candidates.sort((a, b) => Math.hypot(...a) - Math.hypot(...b) || b[0] + b[1] - (a[0] + a[1]))
		for (const [dx, dy] of candidates) {
			const r = new Box(rect.x + dx, rect.y + dy, rect.w, rect.h)
			if (!collides(r, boxes)) return { x: r.x, y: r.y, nudged: true }
		}
	}
	return { x: rect.x, y: rect.y, nudged: false }
}

export function unionBounds(editor: Editor, shapes: (TLShape | undefined)[]): Box | null {
	const boxes = shapes.flatMap((s) => (s ? [editor.getShapePageBounds(s)] : [])).filter((b): b is Box => !!b)
	return boxes.length ? Box.Common(boxes) : null
}

/**
 * Where a new screen goes: to the right of the existing screens (120px gap, room for flow arrows,
 * top-aligned with them, like a row of Figma artboards). On a canvas without
 * screens it goes into the viewport, clear of other shapes.
 */
export function nextScreenPosition(editor: Editor, w: number, h: number): { x: number; y: number } {
	const screens = editor
		.getCurrentPageShapes()
		.filter((s) => s.type === 'ui' && (s.props as { kind?: string }).kind === 'screen' && s.parentId === editor.getCurrentPageId())
	if (screens.length) {
		const b = unionBounds(editor, screens)!
		return { x: b.maxX + 120, y: Math.min(...screens.map((s) => s.y)) }
	}
	if (!editor.getCurrentPageShapes().length) return { x: 0, y: 0 }
	const v = editor.getViewportPageBounds()
	const spot = findFreeSpot(editor, new Box(v.x + 80, v.y + 80, w, h), { avoidAll: true })
	return { x: spot.x, y: spot.y }
}

/**
 * Space (screen px) at the bottom of the canvas covered by floating UI (the
 * voice dock and tldraw's toolbar), read from the DOM so fitting a screen
 * never hides its bottom under them.
 */
export function bottomObstruction(editor: Editor): number {
	const fallback = 140
	if (typeof document === 'undefined') return fallback
	const container = editor.getContainer().getBoundingClientRect()
	const dock = document.querySelector('[data-testid="voice-dock"] > div')?.getBoundingClientRect()
	if (!dock || !dock.height) return fallback
	return Math.max(0, container.bottom - dock.top)
}

/**
 * Like editor.zoomToBounds, but keeps the bottom clear of the voice dock:
 * the bounds are fitted into the viewport minus `inset` on every side and
 * the dock's height at the bottom, centered in what's left.
 */
export function fitBounds(editor: Editor, bounds: Box, opts: { inset?: number; targetZoom?: number; maxZoom?: number; animate?: boolean } = {}) {
	const inset = opts.inset ?? 64
	const vp = editor.getViewportScreenBounds()
	const bottom = Math.max(inset, bottomObstruction(editor) + 16)
	const availW = Math.max(1, vp.w - inset * 2)
	const availH = Math.max(1, vp.h - inset - bottom)
	const fit = Math.min(availW / Math.max(1, bounds.w), availH / Math.max(1, bounds.h))
	const { minZoom, maxZoom } = editor.getCameraOptions().zoomSteps.length
		? { minZoom: Math.min(...editor.getCameraOptions().zoomSteps), maxZoom: Math.max(...editor.getCameraOptions().zoomSteps) }
		: { minZoom: 0.05, maxZoom: 8 }
	const z = Math.max(minZoom, Math.min(opts.targetZoom ? Math.min(opts.targetZoom, fit) : fit, opts.maxZoom ?? 1, maxZoom))
	const left = inset + (availW - bounds.w * z) / 2
	const top = inset + (availH - bounds.h * z) / 2
	editor.setCamera({ x: left / z - bounds.x, y: top / z - bounds.y, z }, opts.animate === false ? undefined : { animation: { duration: 400 } })
}
