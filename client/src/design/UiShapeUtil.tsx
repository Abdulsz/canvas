import type { CSSProperties, ReactNode } from 'react'
import {
	BaseFrameLikeShapeUtil,
	HTMLContainer,
	Rectangle2d,
	resizeBox,
	useEditor,
	useValue,
	type TLDragShapesInInfo,
	type TLDragShapesOutInfo,
	type TLResizeInfo,
	type TLShape,
	type TLShapeId,
} from 'tldraw'
import {
	DEFAULT_THEME,
	ICON_PATHS,
	initials,
	isContainerKind,
	LINE_HEIGHT,
	resolveColor,
	SHADOWS,
	UI_DEFAULT_PROPS,
	uiShapeProps,
	type ThemeSpec,
	type UiProps,
} from '../../../shared/design.ts'

declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		ui: UiProps
	}
}

export type UiShape = TLShape<'ui'>

export const UI_FONT = "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
const FONT = UI_FONT

/** Theme of the nearest screen ancestor (or the shape itself if it is a screen). */
export function themeFor(editor: ReturnType<typeof useEditor>, id: TLShapeId): ThemeSpec {
	let shape = editor.getShape(id)
	while (shape) {
		if (shape.type === 'ui' && (shape as UiShape).props.kind === 'screen') {
			const t = shape.meta?.theme as Partial<ThemeSpec> | undefined
			return { mode: t?.mode === 'dark' ? 'dark' : 'light', primary: t?.primary || DEFAULT_THEME.primary }
		}
		shape = editor.getShape(shape.parentId as TLShapeId)
	}
	return DEFAULT_THEME
}

export function Icon({ name, size, color, strokeWidth = 2 }: { name: string; size: number; color: string; strokeWidth?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: 'block' }}>
			<path d={ICON_PATHS[name] ?? ICON_PATHS.star} />
		</svg>
	)
}

function ScreenLabel({ shape }: { shape: UiShape }) {
	const editor = useEditor()
	const zoom = useValue('zoom', () => editor.getZoomLevel(), [editor])
	const dark = useValue('dark ui', () => editor.user.getIsDarkMode(), [editor])
	return (
		<div
			style={{
				position: 'absolute',
				left: 0,
				bottom: '100%',
				transformOrigin: 'bottom left',
				transform: `scale(${1 / zoom})`,
				padding: '0 0 6px 0',
				font: `500 12px ${FONT}`,
				color: dark ? '#a1a1aa' : '#6b6b76',
				whiteSpace: 'nowrap',
				pointerEvents: 'none',
			}}
		>
			{shape.props.name || 'Screen'}
		</div>
	)
}

function UiView({ shape }: { shape: UiShape }) {
	const editor = useEditor()
	const theme = useValue('ui theme', () => themeFor(editor, shape.id), [editor, shape.id])
	const p = shape.props
	const c = (v: string) => resolveColor(v, theme)
	const fill = c(p.fill)
	const textColor = c(p.textColor)
	const stroke = c(p.stroke)
	const padding = (shape.meta?.layout as { padding?: number[] } | undefined)?.padding
	const base: CSSProperties = {
		width: p.w,
		height: p.h,
		opacity: p.opacity,
		fontFamily: FONT,
		boxSizing: 'border-box',
		pointerEvents: 'all',
		overflow: 'hidden',
	}
	const box: CSSProperties = {
		...base,
		background: fill,
		borderRadius: p.radius,
		boxShadow: SHADOWS[p.shadow] === 'none' ? undefined : SHADOWS[p.shadow],
		border: stroke !== 'transparent' && p.strokeWidth > 0 ? `${p.strokeWidth}px solid ${stroke}` : undefined,
	}
	const textStyle: CSSProperties = {
		color: textColor,
		fontSize: p.fontSize,
		fontWeight: p.fontWeight,
		lineHeight: LINE_HEIGHT,
	}
	let content: ReactNode = null
	let style: CSSProperties = box

	switch (p.kind) {
		case 'screen':
		case 'frame':
		case 'rect':
			break
		case 'text':
			// A one-line box (as laid out) must not wrap even if the DOM font is a hair wider.
			style = {
				...box,
				...textStyle,
				overflow: 'visible',
				textAlign: p.align,
				whiteSpace: p.h < p.fontSize * LINE_HEIGHT * 1.5 ? 'pre' : 'pre-wrap',
				wordBreak: 'break-word',
			}
			content = p.text
			break
		case 'button': {
			const iconSize = Math.round(p.fontSize * 1.25)
			style = {
				...box,
				...textStyle,
				display: 'flex',
				alignItems: 'center',
				justifyContent: p.align === 'left' ? 'flex-start' : p.align === 'right' ? 'flex-end' : 'center',
				gap: 8,
				padding: padding ? `0 ${padding[1]}px 0 ${padding[3]}px` : '0 24px',
				whiteSpace: 'nowrap',
			}
			content = (
				<>
					{p.icon && <Icon name={p.icon} size={iconSize} color={textColor} />}
					{p.text && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.text}</span>}
				</>
			)
			break
		}
		case 'input':
			style = {
				...box,
				...textStyle,
				display: 'flex',
				alignItems: 'center',
				gap: 10,
				padding: padding ? `0 ${padding[1]}px 0 ${padding[3]}px` : '0 16px',
				whiteSpace: 'nowrap',
			}
			content = (
				<>
					{p.icon && <Icon name={p.icon} size={20} color={c('$muted')} />}
					<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, textAlign: p.align }}>{p.text}</span>
				</>
			)
			break
		case 'image': {
			const s = Math.max(16, Math.min(40, Math.min(p.w, p.h) * 0.28))
			style = { ...box, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }
			content = (
				<>
					<Icon name={p.icon || 'image'} size={s} color={textColor} strokeWidth={1.5} />
					{p.text && <span style={{ ...textStyle, fontSize: Math.min(p.fontSize, 13) }}>{p.text}</span>}
				</>
			)
			break
		}
		case 'icon':
			style = { ...base, display: 'flex', alignItems: 'center', justifyContent: 'center', background: fill, borderRadius: p.radius }
			content = <Icon name={p.icon} size={Math.min(p.w, p.h) * (fill === 'transparent' ? 1 : 0.6)} color={textColor} />
			break
		case 'avatar':
			style = {
				...box,
				...textStyle,
				fontSize: Math.max(10, Math.round(Math.min(p.w, p.h) * 0.38)),
				borderRadius: '50%',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				letterSpacing: 0.3,
			}
			content = p.icon ? <Icon name={p.icon} size={Math.min(p.w, p.h) * 0.5} color={textColor} /> : initials(p.text || p.name) || '?'
			break
		case 'toggle': {
			const knob = p.h - 4
			style = { ...base, borderRadius: p.h / 2, background: p.checked ? fill : c('$border'), position: 'relative' }
			content = (
				<div
					style={{
						position: 'absolute',
						top: 2,
						left: p.checked ? p.w - knob - 2 : 2,
						width: knob,
						height: knob,
						borderRadius: '50%',
						background: '#fff',
						boxShadow: '0 1px 3px rgba(0,0,0,.25)',
					}}
				/>
			)
			break
		}
		case 'checkbox':
			style = { ...base, ...textStyle, display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap', overflow: 'visible' }
			content = (
				<>
					<div
						style={{
							width: 20,
							height: 20,
							flexShrink: 0,
							borderRadius: 6,
							boxSizing: 'border-box',
							background: p.checked ? fill : c('$surface'),
							border: p.checked ? 'none' : `1.5px solid ${c('$border')}`,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
						}}
					>
						{p.checked && <Icon name="check" size={14} color="#fff" strokeWidth={3} />}
					</div>
					{p.text && <span>{p.text}</span>}
				</>
			)
			break
		case 'divider':
			style = { ...base, background: fill }
			break
	}

	return (
		<HTMLContainer style={{ overflow: 'visible' }}>
			<div style={style}>{content}</div>
			{p.kind === 'screen' && <ScreenLabel shape={shape} />}
		</HTMLContainer>
	)
}

/**
 * The one design shape. Screens and frames are containers (clip + accept
 * children); everything else is a leaf component. Layout is computed by the
 * executor (shared/design.ts layoutTree) and written into x/y/w/h.
 */
export class UiShapeUtil extends BaseFrameLikeShapeUtil<UiShape> {
	static override type = 'ui' as const
	static override props = uiShapeProps

	override getDefaultProps(): UiProps {
		return { ...UI_DEFAULT_PROPS }
	}

	override getGeometry(shape: UiShape) {
		return new Rectangle2d({ width: Math.max(1, shape.props.w), height: Math.max(1, shape.props.h), isFilled: true })
	}

	override component(shape: UiShape) {
		return <UiView shape={shape} />
	}

	override getIndicatorPath(shape: UiShape) {
		const path = new Path2D()
		const r = shape.props.kind === 'avatar' ? Math.min(shape.props.w, shape.props.h) / 2 : shape.props.radius
		path.roundRect(0, 0, shape.props.w, shape.props.h, Math.min(r, shape.props.w / 2, shape.props.h / 2))
		return path
	}

	override getText(shape: UiShape) {
		return shape.props.text || shape.props.name
	}

	override canEdit() {
		return false
	}

	override hideRotateHandle() {
		return true
	}

	override isFrameLike(shape: UiShape) {
		return isContainerKind(shape.props.kind)
	}

	override providesBackgroundForChildren(): boolean {
		return true
	}

	override canReceiveNewChildrenOfType(shape: UiShape, type: TLShape['type']) {
		return isContainerKind(shape.props.kind) && super.canReceiveNewChildrenOfType(shape, type)
	}

	override canRemoveChildrenOfType(shape: UiShape, type: TLShape['type']) {
		return isContainerKind(shape.props.kind) && super.canRemoveChildrenOfType(shape, type)
	}

	// Only screens clip. tldraw intersects ancestor clip polygons, and nested
	// frames that share edges with their parent (fill width) produce degenerate
	// polygons that hide content, so frames don't clip.
	override getClipPath(shape: UiShape) {
		return shape.props.kind === 'screen' ? super.getClipPath(shape) : undefined
	}

	override onDragShapesIn(shape: UiShape, dragging: TLShape[], info: TLDragShapesInInfo) {
		if (isContainerKind(shape.props.kind)) super.onDragShapesIn(shape, dragging, info)
	}

	override onDragShapesOut(shape: UiShape, dragging: TLShape[], info: TLDragShapesOutInfo) {
		if (isContainerKind(shape.props.kind)) super.onDragShapesOut(shape, dragging, info)
	}

	/** A manual resize pins the size (Figma switches the resized axis to fixed). */
	override onResize(shape: UiShape, info: TLResizeInfo<UiShape>) {
		const next = resizeBox(shape, info)
		const sizing = { ...((shape.meta?.sizing as object) ?? {}) } as Record<string, string>
		if (Math.abs((next.props?.w ?? shape.props.w) - shape.props.w) > 0.5) sizing.w = 'fixed'
		if (Math.abs((next.props?.h ?? shape.props.h) - shape.props.h) > 0.5) sizing.h = 'fixed'
		return { ...next, meta: { ...shape.meta, sizing } }
	}
}
