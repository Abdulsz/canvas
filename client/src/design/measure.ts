import { estimateText, wrapWith, type TextMeasurer } from '../../../shared/design.ts'
import { UI_FONT } from './UiShapeUtil.tsx'

let ctx: CanvasRenderingContext2D | null | undefined

/** Real text metrics from a canvas, in the same font the ui shapes render with. */
export const measureTextDom: TextMeasurer = (text, fontSize, maxWidth, fontWeight = 400) => {
	if (ctx === undefined) ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
	if (!ctx) return estimateText(text, fontSize, maxWidth, fontWeight)
	ctx.font = `${fontWeight} ${fontSize}px ${UI_FONT}`
	const c = ctx
	// +1px so sub-pixel rounding in the DOM never pushes a word onto a new line.
	return wrapWith((s) => Math.ceil(c.measureText(s).width) + 1, text, fontSize, maxWidth)
}

// Start loading the design font early so the first layout measures with it.
if (typeof document !== 'undefined') {
	for (const w of [400, 600, 700]) document.fonts?.load(`${w} 16px 'Inter Variable'`).catch(() => {})
}
