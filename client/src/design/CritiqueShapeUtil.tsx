import {
	HTMLContainer,
	Rectangle2d,
	renderPlaintextFromRichText,
	ShapeUtil,
	useEditor,
	useValue,
	type TLShape,
} from 'tldraw'
import { critiqueShapeProps, NOTE_METRICS, TONE_COLORS, type CritiqueProps } from '../../../shared/critique.ts'
import { UI_FONT } from './UiShapeUtil.tsx'

declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		critique: CritiqueProps
	}
}

export type CritiqueShape = TLShape<'critique'>

function CritiqueView({ shape }: { shape: CritiqueShape }) {
	const editor = useEditor()
	const dark = useValue('dark mode', () => editor.user.getIsDarkMode(), [editor])
	const zoom = useValue('zoom', () => editor.getZoomLevel(), [editor])
	const tone = TONE_COLORS[shape.props.tone] ?? TONE_COLORS.suggestion
	const color = dark ? tone.dark : tone.light
	const { w, h } = shape.props
	if (shape.props.kind === 'highlight') {
		// A thin outline offset from the node (the executor pads it), constant 1.5px on screen,
		// with a faint tint, so it never sits on or hides the node's own text.
		const stroke = 1.5 / Math.max(zoom, 0.05)
		return (
			<HTMLContainer style={{ pointerEvents: 'none' }}>
				<div
					style={{
						width: w,
						height: h,
						boxSizing: 'border-box',
						border: `${stroke}px solid ${color}`,
						borderRadius: 8 + stroke,
						background: `${color}0f`,
					}}
				/>
			</HTMLContainer>
		)
	}
	const s = shape.props.scale || 1
	const M = NOTE_METRICS
	const text = renderPlaintextFromRichText(editor, shape.props.richText)
	// Body without the "@Name " prefix: the addressee is in the header.
	const to = shape.props.to
	const body = to && text.startsWith(`@${to}`) ? text.slice(to.length + 1).trim() : text
	return (
		<HTMLContainer style={{ pointerEvents: 'all' }}>
			<div
				data-testid="critique-note"
				style={{
					width: w,
					height: h,
					boxSizing: 'border-box',
					background: dark ? '#1c1d23' : '#ffffff',
					border: `${s}px solid ${dark ? '#2e3039' : '#e4e5ea'}`,
					borderLeft: `${M.rule * s}px solid ${color}`,
					borderRadius: 10 * s,
					boxShadow: dark ? `0 ${4 * s}px ${16 * s}px rgba(0,0,0,.45)` : `0 ${1 * s}px ${2 * s}px rgba(15,17,28,.06), 0 ${6 * s}px ${18 * s}px -${4 * s}px rgba(15,17,28,.16)`,
					padding: `${M.padY * s}px ${M.padX * s}px`,
					fontFamily: UI_FONT,
					textAlign: 'left',
					overflow: 'hidden',
					display: 'flex',
					flexDirection: 'column',
					gap: M.gap * s,
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: 6 * s, height: M.headerH * s, fontSize: 11 * s, lineHeight: 1, fontWeight: 600, letterSpacing: '0.02em', whiteSpace: 'nowrap', overflow: 'hidden' }}>
					<span style={{ width: 6 * s, height: 6 * s, borderRadius: 99, background: color, flex: 'none' }} />
					<span style={{ color, textTransform: 'uppercase' }}>{tone.label}</span>
					{to && <span style={{ color: dark ? '#a1a3af' : '#62646f', fontWeight: 500, textTransform: 'none', letterSpacing: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>· @{to}</span>}
				</div>
				<div style={{ fontSize: M.fontSize * s, lineHeight: M.lineHeight, color: dark ? '#ececf1' : '#16171c', fontWeight: 400, overflowWrap: 'break-word' }}>{body}</div>
			</div>
		</HTMLContainer>
	)
}

/** The agent's critique overlays: comment cards and node outlines (see shared/critique.ts). */
export class CritiqueShapeUtil extends ShapeUtil<CritiqueShape> {
	static override type = 'critique' as const
	static override props = critiqueShapeProps

	override getDefaultProps(): CritiqueProps {
		return { w: NOTE_METRICS.width, h: 80, kind: 'note', tone: 'suggestion', richText: { type: 'doc', content: [] }, to: '', scale: 1 }
	}

	override getGeometry(shape: CritiqueShape) {
		return new Rectangle2d({ width: Math.max(1, shape.props.w), height: Math.max(1, shape.props.h), isFilled: shape.props.kind === 'note' })
	}

	override component(shape: CritiqueShape) {
		return <CritiqueView shape={shape} />
	}

	override getIndicatorPath(shape: CritiqueShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 10 * (shape.props.kind === 'note' ? shape.props.scale : 1))
		return path
	}

	override getText(shape: CritiqueShape) {
		return renderPlaintextFromRichText(this.editor, shape.props.richText)
	}

	override canEdit() {
		return false
	}

	override canResize() {
		return false
	}

	override hideRotateHandle() {
		return true
	}

	override toSvg(shape: CritiqueShape) {
		const tone = TONE_COLORS[shape.props.tone] ?? TONE_COLORS.suggestion
		const { w, h } = shape.props
		if (shape.props.kind === 'highlight') return <rect width={w} height={h} rx={8} fill="none" stroke={tone.light} strokeWidth={1.5} />
		const s = shape.props.scale || 1
		return (
			<g>
				<rect width={w} height={h} rx={10 * s} fill="#ffffff" stroke="#e4e5ea" strokeWidth={s} />
				<rect width={NOTE_METRICS.rule * s} height={h} fill={tone.light} />
			</g>
		)
	}
}
