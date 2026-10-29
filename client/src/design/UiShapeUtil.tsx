import type { CSSProperties, ReactNode } from 'react'
import {
	BaseFrameLikeShapeUtil,
	HTMLContainer,
	Rectangle2d,
	resizeBox,
	useEditor,
	useValue,
	type Editor,
	type TLDragShapesInInfo,
	type TLDragShapesOutInfo,
	type TLResizeInfo,
	type TLShape,
	type TLShapeId,
} from 'tldraw'
import { bareId } from './tree.ts'
import {
	contrast,
	DEFAULT_THEME,
	FILLED_ICONS,
	ICON_PATHS,
	iconPaths,
	initials,
	isContainerKind,
	letterSpacingFor,
	LINE_HEIGHT,
	resolveColor,
	SHADOWS,
	UI_DEFAULT_PROPS,
	uiShapeProps,
	type ThemeSpec,
	type UiMeta,
	type UiProps,
} from '../../../shared/design.ts'
import { artSvg, chartSvg, homeIndicatorSvg, isPhoneScreen, STATUS_BAR_H, statusBarSvg, TAB_BAR_H, tabBarSvg } from '../../../shared/visuals.ts'

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
	if (FILLED_ICONS.has(name)) {
		return <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, display: 'block' }} dangerouslySetInnerHTML={{ __html: iconPaths(name, color) }} />
	}
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: 'block' }}>
			<path d={ICON_PATHS[name] ?? ICON_PATHS.star} />
		</svg>
	)
}

/** Mixes two #rrggbb colors (t = 0 keeps a). */
function mix(a: string, b: string, t: number): string {
	const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
	if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return a
	const x = p(a)
	const y = p(b)
	return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

/** Nudges a foreground toward white or black until it reads on `bg` (>= 4.5:1). */
function legible(fg: string, bg: string): string {
	if (!/^#[0-9a-f]{6}$/i.test(fg) || !/^#[0-9a-f]{6}$/i.test(bg) || contrast(fg, bg) >= 4.5) return fg
	const toward = contrast('#ffffff', bg) > contrast('#000000', bg) ? '#ffffff' : '#000000'
	let c = fg
	for (let i = 1; i <= 10 && contrast(c, bg) < 4.5; i++) c = mix(fg, toward, i * 0.1)
	return c
}

/** Inline SVG markup from shared/visuals.ts (generated from validated props, never user HTML). */
function Svg({ markup, style }: { markup: string; style?: CSSProperties }) {
	return <div style={{ lineHeight: 0, ...style }} dangerouslySetInnerHTML={{ __html: markup }} />
}

/** Status bar, tab bar and home indicator of a phone screen, under its content. */
function ScreenChrome({ shape, theme }: { shape: UiShape; theme: ThemeSpec }) {
	const p = shape.props
	const meta = shape.meta as Partial<UiMeta>
	const phone = isPhoneScreen(p.w, p.h) && (shape.meta as { chrome?: boolean })?.chrome !== false
	const ink = resolveColor('$text', theme)
	return (
		<>
			{phone && <Svg markup={statusBarSvg(p.w, ink)} style={{ position: 'absolute', left: 0, top: 0, width: p.w, height: STATUS_BAR_H }} />}
			{meta.tabs && <Svg markup={tabBarSvg(p.w, meta.tabs, theme)} style={{ position: 'absolute', left: 0, bottom: 0, width: p.w, height: TAB_BAR_H }} />}
			{phone && <Svg markup={homeIndicatorSvg(p.w, ink)} style={{ position: 'absolute', left: 0, bottom: 0, width: p.w, height: 21 }} />}
		</>
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
				// Never wider than the screen, so neighbouring labels don't run together when zoomed out.
				maxWidth: Math.max(24, shape.props.w * zoom),
				overflow: 'hidden',
				textOverflow: 'ellipsis',
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
	const editorDark = useValue('editor dark', () => shape.props.kind === 'screen' && editor.user.getIsDarkMode(), [editor, shape.props.kind])
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
		letterSpacing: letterSpacingFor(p.fontSize),
	}
	const bw = stroke !== 'transparent' ? p.strokeWidth : 0
	let content: ReactNode = null
	let style: CSSProperties = box

	switch (p.kind) {
		case 'screen': {
			// A light screen on the dark editor canvas gets a hairline ring so its edge reads.
			style = { ...box, position: 'relative', boxShadow: [box.boxShadow, editorDark && theme.mode === 'light' ? '0 0 0 1px rgba(255,255,255,.14)' : ''].filter(Boolean).join(', ') || undefined }
			content = <ScreenChrome shape={shape} theme={theme} />
			break
		}
		case 'frame':
		case 'rect':
			break
		case 'badge': {
			// Pill text stays readable on its tint in both themes (>= 4.5:1).
			const ink = legible(textColor, fill)
			style = {
				...box,
				...textStyle,
				color: ink,
				letterSpacing: 0,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				gap: (shape.meta?.layout as { gap?: number } | undefined)?.gap ?? 4,
				padding: `0 ${Math.max(0, (padding?.[1] ?? 10) - bw)}px 0 ${Math.max(0, (padding?.[3] ?? 10) - bw)}px`,
				whiteSpace: 'nowrap',
			}
			content = (
				<>
					{p.icon && <Icon name={p.icon} size={Math.round(p.fontSize)} color={ink} strokeWidth={2.25} />}
					{p.text && <span>{p.text}</span>}
				</>
			)
			break
		}
		case 'chart': {
			const chart = (shape.meta as Partial<UiMeta>)?.chart
			style = { ...box }
			content = chart ? <Svg markup={chartSvg(chart, p.w, p.h, theme, bareId(shape.id))} /> : null
			break
		}
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
			// Solid buttons get a crisp contact shadow and a faint top highlight; outlined ones a hairline lift.
			const solid = fill !== 'transparent' && stroke === 'transparent'
			const lift = p.shadow !== 'none' ? box.boxShadow : solid ? '0 1px 2px rgba(15,17,28,.14), inset 0 1px 0 rgba(255,255,255,.14)' : fill !== 'transparent' ? '0 1px 2px rgba(15,17,28,.05)' : undefined
			style = {
				...box,
				...textStyle,
				boxShadow: lift,
				display: 'flex',
				alignItems: 'center',
				justifyContent: p.align === 'left' ? 'flex-start' : p.align === 'right' ? 'flex-end' : 'center',
				gap: 8,
				// The border sits inside the box: take it out of the padding so hugged labels still fit.
				padding: `0 ${Math.max(0, (padding?.[1] ?? 24) - bw)}px 0 ${Math.max(0, (padding?.[3] ?? 24) - bw)}px`,
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
				padding: `0 ${Math.max(0, (padding?.[1] ?? 16) - bw)}px 0 ${Math.max(0, (padding?.[3] ?? 16) - bw)}px`,
				whiteSpace: 'nowrap',
			}
			content = (
				<>
					{p.icon && <Icon name={p.icon} size={20} color={c('$muted')} />}
					<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, textAlign: p.align }}>{p.text}</span>
					{(shape.meta as Partial<UiMeta>)?.trailingIcon && <Icon name={(shape.meta as Partial<UiMeta>).trailingIcon!} size={20} color={c('$muted')} />}
				</>
			)
			break
		case 'image': {
			// Generated, themed abstract art (soft blobs, rings or a sun over hills), never a gray box.
			// The text is alt text only; an explicit icon sits on a frosted disc in the middle.
			const s = Math.max(14, Math.min(28, Math.min(p.w, p.h) * 0.2))
			const disc = Math.round(s * 2.2)
			style = { ...box, position: 'relative' }
			content = (
				<>
					<Svg markup={artSvg(bareId(shape.id), p.w, p.h, theme, p.text)} style={{ position: 'absolute', inset: 0 }} />
					{p.icon && Math.min(p.w, p.h) >= 40 && (
						<div style={{ position: 'absolute', left: (p.w - disc) / 2, top: (p.h - disc) / 2, width: disc, height: disc, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.28)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.35)' }}>
							<Icon name={p.icon} size={s} color="#ffffff" strokeWidth={1.9} />
						</div>
					)}
				</>
			)
			break
		}
		case 'icon':
			style = { ...base, display: 'flex', alignItems: 'center', justifyContent: 'center', background: fill, borderRadius: p.radius }
			content = <Icon name={p.icon} size={Math.round(Math.min(p.w, p.h) * (fill === 'transparent' ? 1 : 0.55))} color={textColor} />
			break
		case 'avatar':
			style = {
				...box,
				...textStyle,
				color: legible(textColor, fill),
				letterSpacing: 0.2,
				fontSize: Math.max(10, Math.round(Math.min(p.w, p.h) * 0.38)),
				borderRadius: '50%',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
			}
			content = p.icon ? <Icon name={p.icon} size={Math.min(p.w, p.h) * 0.5} color={legible(textColor, fill)} /> : initials(p.text || p.name) || '?'
			break
		case 'toggle': {
			const knob = p.h - 4
			style = {
				...base,
				borderRadius: p.h / 2,
				background: p.checked ? fill : c('$surfaceAlt'),
				boxShadow: p.checked ? undefined : `inset 0 0 0 1px ${c('$border')}`,
				position: 'relative',
			}
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
						boxShadow: '0 1px 2px rgba(0,0,0,.16), 0 2px 6px rgba(0,0,0,.10)',
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
						{p.checked && <Icon name="check" size={14} color={c('$onPrimary')} strokeWidth={3} />}
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

const patchedEditors = new WeakSet<Editor>()

/**
 * tldraw exports a lone frame-like shape (one screen or frame) as its children
 * on a plain tldraw-colored background: it never paints the frame itself, so a
 * dark screen came out white (or black when transparent) behind light text.
 * Exporting [id, id] is the same shapes but not a "single frame", so the
 * screen's own themed background is painted like everything else. This covers
 * every export path (Export PNG, Copy as PNG, the agent's canvas images).
 */
function paintSingleScreenExports(editor: Editor) {
	if (patchedEditors.has(editor)) return
	patchedEditors.add(editor)
	const original = editor.getSvgElement.bind(editor)
	editor.getSvgElement = ((shapes: Parameters<Editor['getSvgElement']>[0], opts?: Parameters<Editor['getSvgElement']>[1]) => {
		if (shapes.length === 1) {
			const only = shapes[0]
			const shape = typeof only === 'string' ? editor.getShape(only) : only
			if (shape?.type === 'ui' && isContainerKind((shape as UiShape).props.kind)) shapes = [shape.id, shape.id]
		}
		return original(shapes, opts)
	}) as Editor['getSvgElement']
}

/**
 * The one design shape. Screens and frames are containers (clip + accept
 * children); everything else is a leaf component. Layout is computed by the
 * executor (shared/design.ts layoutTree) and written into x/y/w/h.
 */
export class UiShapeUtil extends BaseFrameLikeShapeUtil<UiShape> {
	static override type = 'ui' as const
	static override props = uiShapeProps

	constructor(editor: Editor) {
		super(editor)
		paintSingleScreenExports(editor)
	}

	/** A screen is the whole picture: exporting it (with its contents) needs no padding. */
	override isExportBoundsContainer(shape: UiShape) {
		return shape.props.kind === 'screen'
	}

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
