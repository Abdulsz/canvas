import type { Box, Editor } from 'tldraw'

/** Phones (and other narrow canvases) fit with slim margins so a screen reads at a useful size. */
export const isNarrowCanvas = (editor: Editor) => editor.getViewportScreenBounds().w < 600

/**
 * Screen px at the bottom of the canvas covered by the floating voice dock,
 * measured from the DOM. The dock grows when it shows a two-line caption, so
 * the reserve assumes that taller state (>= 64px) even while it is idle: a
 * screen fitted while the dock is quiet stays clear once the agent talks.
 */
export function dockReserve(editor: Editor): number {
	if (typeof document === 'undefined') return 140
	const container = editor.getContainer().getBoundingClientRect()
	const dock = document.querySelector('[data-testid="voice-dock"] > div')?.getBoundingClientRect()
	if (!dock || !dock.height) return 140
	const top = dock.bottom - Math.max(dock.height, 64)
	return Math.max(0, container.bottom - top)
}

/**
 * Shell-side zoom to fit (zoom to fit / selection, Layers reveal, and the
 * agent's focus_view on this tab): fits `bounds` into the part of the canvas
 * that is actually visible, i.e. below the screen-name label and above the
 * voice dock, with slimmer margins on phones.
 */
export function fitVisible(editor: Editor, bounds: Box, opts: { maxZoom?: number; targetZoom?: number; animate?: boolean } = {}) {
	const vp = editor.getViewportScreenBounds()
	const narrow = isNarrowCanvas(editor)
	const side = narrow ? 14 : 64
	// Screens carry their name label ~24px above them.
	const top = narrow ? 44 : 72
	const bottom = Math.max(narrow ? 20 : 64, dockReserve(editor) + (narrow ? 10 : 20))
	const availW = Math.max(1, vp.w - side * 2)
	const availH = Math.max(1, vp.h - top - bottom)
	const fit = Math.min(availW / Math.max(1, bounds.w), availH / Math.max(1, bounds.h))
	const steps = editor.getCameraOptions().zoomSteps
	const minZoom = steps.length ? Math.min(...steps) : 0.05
	const maxStep = steps.length ? Math.max(...steps) : 8
	const z = Math.max(minZoom, Math.min(opts.targetZoom ? Math.min(opts.targetZoom, fit) : fit, opts.maxZoom ?? 1, maxStep))
	const left = side + (availW - bounds.w * z) / 2
	const y = top + Math.max(0, (availH - bounds.h * z) / 2)
	editor.setCamera({ x: left / z - bounds.x, y: y / z - bounds.y, z }, opts.animate === false ? undefined : { animation: { duration: 400 } })
}
