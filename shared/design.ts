// The design document model shared by the client (renderer + executor) and the
// server (schema). Everything here is pure: no editor, no DOM.
//
// Every design element is one tldraw shape of type 'ui'. Visual properties are
// shape props (validated on both sides); layout lives in shape meta so it can
// evolve without schema migrations. See docs/DESIGN_PLAN.md.

import { T } from '@tldraw/validate'
import { artSvg, chartSvg, homeIndicatorSvg, isPhoneScreen, normalizeChart, normalizeTabs, statusBarSvg, tabBarSvg, type ChartSpec, type TabsSpec } from './visuals.ts'

// ------------------------------------------------------------------ types

export const UI_KINDS = [
	'screen',
	'frame',
	'text',
	'button',
	'input',
	'image',
	'icon',
	'avatar',
	'toggle',
	'checkbox',
	'divider',
	'rect',
	'badge',
	'chart',
] as const
export type UiKind = (typeof UI_KINDS)[number]

export const CONTAINER_KINDS = new Set<UiKind>(['screen', 'frame'])
export const isContainerKind = (kind: string) => CONTAINER_KINDS.has(kind as UiKind)

export type SizeMode = 'fixed' | 'fill' | 'hug'
export type Sizing = { w: SizeMode; h: SizeMode }
export type LayoutMode = 'vertical' | 'horizontal' | 'none'
export type AlignItems = 'start' | 'center' | 'end' | 'stretch'
export type Justify = 'start' | 'center' | 'end' | 'space-between'
export type LayoutSpec = {
	mode: LayoutMode
	gap: number
	/** [top, right, bottom, left] */
	padding: [number, number, number, number]
	alignItems: AlignItems
	justify: Justify
}
export type ThemeMode = 'light' | 'dark'
export type ThemeSpec = { mode: ThemeMode; primary: string }

export type UiAlign = 'left' | 'center' | 'right'
export type UiShadow = 'none' | 'sm' | 'md' | 'lg'

/** Props of the tldraw 'ui' shape. */
export type UiProps = {
	w: number
	h: number
	kind: UiKind
	name: string
	text: string
	icon: string
	fill: string
	textColor: string
	stroke: string
	strokeWidth: number
	radius: number
	fontSize: number
	fontWeight: number
	align: UiAlign
	shadow: UiShadow
	opacity: number
	checked: boolean
}

/** Layout-related shape meta of a 'ui' shape. */
export type UiMeta = {
	layout?: LayoutSpec
	sizing: Sizing
	order?: number
	/** Chart data (kind 'chart'). */
	chart?: ChartSpec
	/** Bottom tab bar of a phone screen. */
	tabs?: TabsSpec
	/** Trailing icon of an input (e.g. 'eye' on a password field). */
	trailingIcon?: string
	theme?: ThemeSpec
}

/** What the agent sends to describe a node (see shared/tools.ts). */
export type UiNodeSpec = {
	id: string
	type?: UiKind
	name?: string
	text?: string
	icon?: string
	width?: number | 'fill' | 'hug'
	height?: number | 'fill' | 'hug'
	fill?: string
	textColor?: string
	stroke?: string
	strokeWidth?: number
	radius?: number
	fontSize?: number
	fontWeight?: number
	align?: UiAlign
	shadow?: UiShadow
	opacity?: number
	checked?: boolean
	layout?: LayoutMode
	gap?: number
	padding?: number | number[]
	alignItems?: AlignItems
	justify?: Justify
	/** chart: 'bar' | 'line', with data (numbers), labels (x axis), highlight (index), prefix/suffix for values. */
	chart?: string
	data?: unknown[]
	labels?: unknown[]
	highlight?: number
	prefix?: string
	suffix?: string
	/** Screens: bottom tab bar items and the active one. */
	tabs?: unknown
	activeTab?: number
	/** Inputs: an icon at the end (eye on a password field, chevron on a picker). */
	trailingIcon?: string
	/** Frames: build `template` once per entry of `items`, replacing {key} with the entry's values. */
	template?: UiNodeSpec
	items?: Record<string, unknown>[]
	/** Frames with items: a divider between generated rows. */
	dividers?: boolean
	x?: number
	y?: number
	children?: UiNodeSpec[]
}

// ------------------------------------------------------- schema (tldraw)

export const uiShapeProps = {
	w: T.number,
	h: T.number,
	kind: T.literalEnum(...UI_KINDS),
	name: T.string,
	text: T.string,
	icon: T.string,
	fill: T.string,
	textColor: T.string,
	stroke: T.string,
	strokeWidth: T.number,
	radius: T.number,
	fontSize: T.number,
	fontWeight: T.number,
	align: T.literalEnum('left', 'center', 'right'),
	shadow: T.literalEnum('none', 'sm', 'md', 'lg'),
	opacity: T.number,
	checked: T.boolean,
}

export const UI_DEFAULT_PROPS: UiProps = {
	w: 100,
	h: 100,
	kind: 'rect',
	name: '',
	text: '',
	icon: '',
	fill: 'transparent',
	textColor: '$text',
	stroke: 'transparent',
	strokeWidth: 1,
	radius: 0,
	fontSize: 16,
	fontWeight: 400,
	align: 'left',
	shadow: 'none',
	opacity: 1,
	checked: false,
}

// ------------------------------------------------------ presets & tokens

export type KindDefault = { props: Partial<UiProps>; sizing: Sizing; layout?: LayoutSpec }

const pad = (n: number): [number, number, number, number] => [n, n, n, n]
const vstack = (gap: number, padding: number): LayoutSpec => ({
	mode: 'vertical',
	gap,
	padding: pad(padding),
	alignItems: 'stretch',
	justify: 'start',
})

export const KIND_DEFAULTS: Record<UiKind, KindDefault> = {
	screen: { props: { w: 390, h: 844, fill: '$bg', radius: 0, shadow: 'md' }, sizing: { w: 'fixed', h: 'fixed' }, layout: vstack(16, 24) },
	frame: { props: { w: 200, h: 100, fill: 'transparent' }, sizing: { w: 'fill', h: 'hug' }, layout: vstack(12, 0) },
	text: { props: { w: 100, h: 22, textColor: '$text', fontSize: 16, fontWeight: 400 }, sizing: { w: 'hug', h: 'hug' } },
	button: {
		props: { w: 120, h: 48, fill: '$primary', textColor: '$onPrimary', radius: 12, fontSize: 16, fontWeight: 600, align: 'center' },
		sizing: { w: 'hug', h: 'fixed' },
		layout: { mode: 'horizontal', gap: 8, padding: [0, 24, 0, 24], alignItems: 'center', justify: 'center' },
	},
	input: {
		props: { w: 280, h: 48, fill: '$surface', stroke: '$border', strokeWidth: 1, textColor: '$muted', radius: 12, fontSize: 16 },
		sizing: { w: 'fill', h: 'fixed' },
		layout: { mode: 'horizontal', gap: 12, padding: [0, 16, 0, 16], alignItems: 'center', justify: 'start' },
	},
	image: { props: { w: 300, h: 160, fill: '$surfaceAlt', textColor: '$muted', radius: 16 }, sizing: { w: 'fill', h: 'fixed' } },
	icon: { props: { w: 24, h: 24, textColor: '$text', icon: 'star' }, sizing: { w: 'fixed', h: 'fixed' } },
	avatar: { props: { w: 40, h: 40, fill: '$primarySoft', textColor: '$primary', fontSize: 15, fontWeight: 600 }, sizing: { w: 'fixed', h: 'fixed' } },
	toggle: { props: { w: 48, h: 28, fill: '$primary', checked: true }, sizing: { w: 'fixed', h: 'fixed' } },
	checkbox: { props: { w: 120, h: 22, fill: '$primary', textColor: '$text', fontSize: 15 }, sizing: { w: 'hug', h: 'hug' } },
	divider: { props: { w: 100, h: 1, fill: '$border' }, sizing: { w: 'fill', h: 'fixed' } },
	rect: { props: { w: 100, h: 100, fill: '$surfaceAlt', radius: 8 }, sizing: { w: 'fixed', h: 'fixed' } },
	badge: {
		props: { w: 60, h: 26, fill: '$primarySoft', textColor: '$primary', radius: 999, fontSize: 13, fontWeight: 600, align: 'center' },
		sizing: { w: 'hug', h: 'hug' },
		layout: { mode: 'horizontal', gap: 4, padding: [4, 10, 4, 10], alignItems: 'center', justify: 'center' },
	},
	chart: { props: { w: 400, h: 220, fill: 'transparent', textColor: '$muted' }, sizing: { w: 'fill', h: 'fixed' } },
}

export const DEVICES = {
	iphone: { w: 390, h: 844 },
	android: { w: 412, h: 915 },
	tablet: { w: 834, h: 1194 },
	desktop: { w: 1440, h: 1024 },
	watch: { w: 198, h: 242 },
} as const
export type Device = keyof typeof DEVICES

export const DEFAULT_PRIMARY = '#5b5bd6'
export const DEFAULT_THEME: ThemeSpec = { mode: 'light', primary: DEFAULT_PRIMARY }

export const TOKENS = ['bg', 'surface', 'surfaceAlt', 'primary', 'primarySoft', 'onPrimary', 'text', 'muted', 'border', 'success', 'successSoft', 'warning', 'warningSoft', 'danger', 'dangerSoft'] as const
export type Token = (typeof TOKENS)[number]

// Refined neutrals (a faint cool cast, never pure gray on gray). Light: an
// off-white canvas with pure-white cards so surfaces separate without heavy
// borders. Dark: layered near-blacks, each surface a clear step lighter.
// $muted keeps >= 4.5:1 on $bg and $surface in both modes.
export const THEMES: Record<ThemeMode, Record<Token, string>> = {
	light: {
		bg: '#f7f7f9',
		surface: '#ffffff',
		surfaceAlt: '#eff0f3',
		primary: DEFAULT_PRIMARY,
		primarySoft: '#ececfb',
		onPrimary: '#ffffff',
		text: '#0e0f13',
		muted: '#62646f',
		border: '#e3e4e9',
		success: '#15803d',
		successSoft: '#dcfce7',
		warning: '#92400e',
		warningSoft: '#fef3c7',
		danger: '#dc2626',
		dangerSoft: '#fee2e2',
	},
	dark: {
		bg: '#0b0c0f',
		surface: '#16171c',
		surfaceAlt: '#262830',
		primary: DEFAULT_PRIMARY,
		primarySoft: '#2a2b55',
		onPrimary: '#ffffff',
		text: '#f4f4f6',
		muted: '#a1a3af',
		border: '#2c2e38',
		success: '#4ade80',
		successSoft: '#13301f',
		warning: '#fbbf24',
		warningSoft: '#33270d',
		danger: '#f87171',
		dangerSoft: '#3a1717',
	},
}

/** Resolves a color value (`#hex`, `transparent`, CSS color, or `$token`) against a theme. */
export function resolveColor(value: string | undefined, theme: Partial<ThemeSpec> = DEFAULT_THEME): string {
	const v = (value ?? '').trim()
	if (!v || v === 'none') return 'transparent'
	const key = v.startsWith('$') ? v.slice(1) : v
	if ((TOKENS as readonly string[]).includes(key)) {
		const mode = theme.mode === 'dark' ? 'dark' : 'light'
		const primary = themePrimary(theme)
		if (key === 'primary') return primary
		// A quiet tint of the brand for icon tiles, chips and avatars.
		if (key === 'primarySoft') return parseHex(primary) ? mixHex(primary, THEMES[mode].surface, mode === 'dark' ? 0.74 : 0.88) : THEMES[mode].primarySoft
		// Text on the brand color: white, or near-black when the brand is light (yellow, mint...).
		if (key === 'onPrimary') return contrast(primary, '#ffffff') >= 3 ? THEMES[mode].onPrimary : '#111827'
		return THEMES[mode][key as Token]
	}
	return v
}

/**
 * The $primary color for a theme. In dark mode a dark brand color (coffee brown,
 * navy) is lightened until it stands out from the background, so buttons and
 * primary-colored links stay readable after "switch to dark mode".
 */
export function themePrimary(theme: Partial<ThemeSpec>): string {
	const primary = theme.primary || DEFAULT_PRIMARY
	if (theme.mode !== 'dark' || !parseHex(primary)) return primary
	let c = primary
	for (let i = 1; i <= 10 && contrast(c, THEMES.dark.bg) < 3.5; i++) c = mixHex(primary, '#ffffff', i * 0.08)
	return c
}

export function parseHex(hex: string): [number, number, number] | null {
	let h = hex.trim().replace(/^#/, '')
	if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, (x) => x + x)
	if (!/^[0-9a-f]{6}$/i.test(h)) return null
	const n = parseInt(h, 16)
	return [n >> 16, (n >> 8) & 255, n & 255]
}

export function mixHex(a: string, b: string, t: number): string {
	const x = parseHex(a)!
	const y = parseHex(b)!
	return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

function luminance(hex: string): number {
	const rgb = parseHex(hex)
	if (!rgb) return 0.5
	const [r, g, b] = rgb.map((v) => {
		const c = v / 255
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
	})
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two hex colors. */
export function contrast(a: string, b: string): number {
	const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
	return (l1 + 0.05) / (l2 + 0.05)
}

// Simple 24x24 stroke icons (feather-style paths), rendered by the client and the HTML export.
export const ICON_PATHS: Record<string, string> = {
	search: 'M18 11a7 7 0 1 1-14 0a7 7 0 1 1 14 0z M21 21l-4.35-4.35',
	user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M16 7a4 4 0 1 1-8 0a4 4 0 1 1 8 0z',
	home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10',
	settings:
		'M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
	bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0',
	heart: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
	star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
	plus: 'M12 5v14 M5 12h14',
	minus: 'M5 12h14',
	menu: 'M3 6h18 M3 12h18 M3 18h18',
	'arrow-left': 'M19 12H5 M12 19l-7-7 7-7',
	'arrow-right': 'M5 12h14 M12 5l7 7-7 7',
	'chevron-left': 'M15 18l-6-6 6-6',
	'chevron-right': 'M9 18l6-6-6-6',
	'chevron-down': 'M6 9l6 6 6-6',
	check: 'M20 6L9 17l-5-5',
	x: 'M18 6L6 18 M6 6l12 12',
	mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6',
	lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 10 0v4',
	eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0z',
	cart: 'M10 21a1 1 0 1 1-2 0a1 1 0 1 1 2 0z M21 21a1 1 0 1 1-2 0a1 1 0 1 1 2 0z M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6',
	chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
	calendar: 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M16 2v4 M8 2v4 M3 10h18',
	image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M10 8.5a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0z M21 15l-5-5L5 21',
	more: 'M13 12a1 1 0 1 1-2 0a1 1 0 1 1 2 0z M20 12a1 1 0 1 1-2 0a1 1 0 1 1 2 0z M6 12a1 1 0 1 1-2 0a1 1 0 1 1 2 0z',
	trash: 'M3 6h18 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6 M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
	edit: 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z',
	share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8 M16 6l-4-4-4 4 M12 2v13',
	filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
	play: 'M5 3l14 9-14 9V3z',
	camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M16 13a4 4 0 1 1-8 0a4 4 0 1 1 8 0z',
	phone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z',
	globe: 'M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
	logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
	chart: 'M18 20V10 M12 20V4 M6 20v-6',
	bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
	coffee: 'M18 8h1a4 4 0 0 1 0 8h-1 M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z M6 1v3 M10 1v3 M14 1v3',
	'map-pin': 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M15 10a3 3 0 1 1-6 0a3 3 0 1 1 6 0z',
	clock: 'M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0z M12 6v6l4 2',
	'credit-card': 'M3 4h18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M1 10h22',
	gift: 'M20 12v10H4V12 M2 7h20v5H2z M12 22V7 M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
	sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
	zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
	'trending-up': 'M23 6l-9.5 9.5-5-5L1 18 M17 6h6v6',
	'arrow-up-right': 'M7 17L17 7 M7 7h10v10',
	'arrow-down-right': 'M7 7l10 10 M17 7v10H7',
	users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0a4 4 0 1 1 8 0z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
	package: 'M16.5 9.4l-9-5.19 M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12',
	layers: 'M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
	grid: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
	shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
	moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
	google: 'M21.6 12.23c0-.68-.06-1.36-.18-2.02H12v3.83h5.4a4.62 4.62 0 0 1-2 3.03v2.51h3.24c1.9-1.75 2.96-4.33 2.96-7.35z M12 22c2.7 0 4.98-.9 6.64-2.42l-3.24-2.51c-.9.6-2.05.96-3.4.96-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22z M6.4 13.9a6 6 0 0 1 0-3.8V7.51H3.06a10 10 0 0 0 0 8.98z M12 5.98c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.51L6.4 10.1C7.19 7.74 9.4 5.98 12 5.98z',
	apple: 'M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31a4.05 4.05 0 0 0-3.19-1.73c-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76a4.26 4.26 0 0 0-3.6 2.19c-1.54 2.67-.39 6.62 1.1 8.78.73 1.06 1.6 2.25 2.74 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13a9.4 9.4 0 0 0 1.2-2.47 3.83 3.83 0 0 1-2.26-3.55z M14.18 6.17c.6-.74 1.01-1.75.9-2.77-.87.04-1.93.58-2.55 1.31-.56.64-1.05 1.68-.92 2.67.97.08 1.96-.49 2.57-1.21z',
	receipt: 'M4 2v20l3-2 3 2 2-1.5L14 22l3-2 3 2V2l-3 2-3-2-2 1.5L10 2 7 4z M8 9h8 M8 13h8 M8 17h5',
	refresh: 'M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
	wallet: 'M20 7H5a2 2 0 0 1 0-4h13v4 M3 5v14a2 2 0 0 0 2 2h15V7 M16 14h.01',
	'eye-off': 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94 M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19 M1 1l22 22 M14.12 14.12a3 3 0 1 1-4.24-4.24',
	headphones: 'M3 18v-6a9 9 0 0 1 18 0v6 M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z',
	music: 'M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0z M21 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0z',
	target: 'M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0z M18 12a6 6 0 1 1-12 0a6 6 0 1 1 12 0z M14 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0z',
	inbox: 'M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
	folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
	'check-circle': 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3',
	sun: 'M17 12a5 5 0 1 1-10 0a5 5 0 1 1 10 0z M12 1v2 M12 21v2 M4.22 4.22l1.42 1.42 M18.36 18.36l1.42 1.42 M1 12h2 M21 12h2 M4.22 19.78l1.42-1.42 M18.36 5.64l1.42-1.42',
}
export const ICONS = Object.keys(ICON_PATHS)

// ------------------------------------------------------------ measurement

export const LINE_HEIGHT = 1.4
const CHAR_WIDTH = 0.55

export type TextMeasurer = (text: string, fontSize: number, maxWidth?: number, fontWeight?: number) => { w: number; h: number }

/** Rough text size estimate (no DOM): 0.55em per char, 1.4 line height, word wrapping at maxWidth. */
export function estimateText(text: string, fontSize: number, maxWidth?: number, fontWeight = 400): { w: number; h: number; lines: number } {
	const cw = fontSize * CHAR_WIDTH * (fontWeight >= 600 ? 1.04 : 1)
	const lh = fontSize * LINE_HEIGHT
	const paragraphs = String(text ?? '').split('\n')
	let lines = 0
	let widest = 0
	for (const para of paragraphs) {
		const naturalW = para.length * cw
		if (!maxWidth || naturalW <= maxWidth) {
			lines++
			widest = Math.max(widest, naturalW)
			continue
		}
		let line = 0
		for (const word of para.split(/\s+/).filter(Boolean)) {
			const ww = word.length * cw
			const next = line ? line + cw + ww : ww
			if (line && next > maxWidth) {
				lines++
				widest = Math.max(widest, line)
				line = ww
			} else line = next
		}
		lines++
		widest = Math.max(widest, Math.min(line, maxWidth))
	}
	return { w: Math.ceil(Math.min(widest, maxWidth ?? Infinity)), h: Math.ceil(Math.max(1, lines) * lh), lines: Math.max(1, lines) }
}

let activeMeasurer: TextMeasurer = estimateText

/** Text size used by the layout engine: the estimate, or the measurer passed to layoutTree. */
export function measureText(text: string, fontSize: number, maxWidth?: number, fontWeight = 400): { w: number; h: number } {
	return activeMeasurer(text, fontSize, maxWidth, fontWeight)
}

/**
 * Word-wrapping on top of a single-line width function (e.g. canvas
 * measureText in the browser). Lines are 1.4 x fontSize tall.
 */
export function wrapWith(lineWidth: (s: string) => number, text: string, fontSize: number, maxWidth?: number) {
	let lines = 0
	let widest = 0
	for (const para of String(text ?? '').split('\n')) {
		const full = lineWidth(para)
		if (!maxWidth || full <= maxWidth) {
			lines++
			widest = Math.max(widest, full)
			continue
		}
		let line = ''
		for (const word of para.split(/\s+/).filter(Boolean)) {
			const next = line ? `${line} ${word}` : word
			if (line && lineWidth(next) > maxWidth) {
				lines++
				widest = Math.max(widest, lineWidth(line))
				line = word
			} else line = next
		}
		lines++
		widest = Math.max(widest, lineWidth(line))
	}
	return { w: Math.ceil(Math.min(widest, maxWidth ?? Infinity)), h: Math.ceil(Math.max(1, lines) * fontSize * LINE_HEIGHT) }
}

// ------------------------------------------------------------- auto layout

export type LayoutNode = {
	id: string
	kind: UiKind | string
	w: number
	h: number
	x?: number
	y?: number
	text?: string
	icon?: string
	fontSize?: number
	fontWeight?: number
	sizing?: Partial<Sizing>
	layout?: Partial<LayoutSpec>
	children?: LayoutNode[]
}
export type LayoutBox = { x: number; y: number; w: number; h: number }

const fullLayout = (node: LayoutNode): LayoutSpec | null => {
	const l = node.layout
	if (!l) return null
	return {
		mode: l.mode ?? 'vertical',
		gap: l.gap ?? 0,
		padding: normalizePadding(l.padding),
		alignItems: l.alignItems ?? 'start',
		justify: l.justify ?? 'start',
	}
}
const sizingOf = (node: LayoutNode, axis: 'w' | 'h'): SizeMode => node.sizing?.[axis] ?? 'fixed'
const kids = (node: LayoutNode) => node.children ?? []

/** Content size of a leaf when hugging. */
function leafHugW(node: LayoutNode): number {
	const fs = node.fontSize ?? 16
	const text = node.text ?? ''
	const l = fullLayout(node)
	const padX = l ? l.padding[1] + l.padding[3] : 0
	switch (node.kind) {
		case 'text':
			return measureText(text, fs, undefined, node.fontWeight).w
		case 'button':
		case 'badge': {
			const t = text ? measureText(text, fs, undefined, node.fontWeight).w : 0
			const icon = node.icon ? Math.round(fs * (node.kind === 'badge' ? 1 : 1.25)) : 0
			return Math.ceil(t + icon + (t && icon ? (l?.gap ?? 8) : 0) + padX)
		}
		case 'checkbox':
			return text ? Math.ceil(20 + 10 + measureText(text, fs).w) : 20
		case 'input': {
			const t = measureText(text || 'Placeholder', fs).w
			return Math.ceil(t + padX + (node.icon ? 30 : 0))
		}
		default:
			return node.w
	}
}
/** Width a leaf needs to show its content (label, icon, padding) without clipping. */
export function hugWidth(node: LayoutNode, measure?: TextMeasurer): number {
	const prev = activeMeasurer
	activeMeasurer = measure ?? estimateText
	try {
		return leafHugW(node)
	} finally {
		activeMeasurer = prev
	}
}
function leafHugH(node: LayoutNode, w: number): number {
	const fs = node.fontSize ?? 16
	switch (node.kind) {
		case 'text':
			return measureText(node.text ?? '', fs, w, node.fontWeight).h
		case 'checkbox':
			return Math.max(20, Math.ceil(fs * LINE_HEIGHT))
		case 'badge': {
			const l = fullLayout(node)
			return Math.ceil(fs * LINE_HEIGHT) + (l ? l.padding[0] + l.padding[2] : 8)
		}
		case 'button':
		case 'input':
			return Math.max(Math.ceil(fs * LINE_HEIGHT) + 24, 40)
		default:
			return node.h
	}
}

/** Natural (hug) width of a node; fill counts as its natural width here. */
function naturalW(node: LayoutNode): number {
	if (sizingOf(node, 'w') === 'fixed') return node.w
	const l = fullLayout(node)
	const cs = kids(node)
	if (!isContainerKind(node.kind) || !l) return sizingOf(node, 'w') === 'fill' && !['text', 'button', 'checkbox'].includes(node.kind) ? node.w : leafHugW(node)
	if (sizingOf(node, 'w') === 'fill' && !cs.length) return node.w
	const px = l.padding[1] + l.padding[3]
	if (l.mode === 'none') return Math.max(0, ...cs.map((c) => (c.x ?? 0) + naturalW(c))) + px
	const ws = cs.map(naturalW)
	if (l.mode === 'horizontal') return ws.reduce((a, b) => a + b, 0) + l.gap * Math.max(0, cs.length - 1) + px
	return Math.max(0, ...ws) + px
}

/** Natural (hug) height of a node at a given width. */
function naturalH(node: LayoutNode, w: number): number {
	if (sizingOf(node, 'h') === 'fixed') return node.h
	const l = fullLayout(node)
	const cs = kids(node)
	if (!isContainerKind(node.kind) || !l) return sizingOf(node, 'h') === 'fill' && node.kind !== 'text' ? node.h : leafHugH(node, w)
	if (sizingOf(node, 'h') === 'fill' && !cs.length) return node.h
	const py = l.padding[0] + l.padding[2]
	const widths = childWidths(node, l, w)
	if (l.mode === 'none') return Math.max(0, ...cs.map((c, i) => (c.y ?? 0) + naturalH(c, widths[i]))) + py
	const hs = cs.map((c, i) => naturalH(c, widths[i]))
	if (l.mode === 'vertical') return hs.reduce((a, b) => a + b, 0) + l.gap * Math.max(0, cs.length - 1) + py
	return Math.max(0, ...hs) + py
}

/** Splits `free` space equally among `count` fill children. */
const share = (free: number, count: number) => (count ? Math.max(0, free) / count : 0)

function childWidths(node: LayoutNode, l: LayoutSpec, w: number): number[] {
	const cs = kids(node)
	const inner = Math.max(0, w - l.padding[1] - l.padding[3])
	if (l.mode === 'vertical' || l.mode === 'none') {
		return cs.map((c) => {
			const s = sizingOf(c, 'w')
			// Badges always hug: a status pill never stretches across its column.
			if (s === 'fill' || (l.mode === 'vertical' && l.alignItems === 'stretch' && s === 'hug' && c.kind !== 'badge')) return inner
			if (s === 'hug') return Math.min(naturalW(c), inner || naturalW(c))
			return c.w
		})
	}
	// horizontal: fixed/hug take their size, fill shares the rest
	const sizes = cs.map((c) => (sizingOf(c, 'w') === 'fill' ? 0 : naturalW(c)))
	const fills = cs.filter((c) => sizingOf(c, 'w') === 'fill').length
	const used = sizes.reduce((a, b) => a + b, 0) + l.gap * Math.max(0, cs.length - 1)
	const each = share(inner - used, fills)
	return cs.map((c, i) => (sizingOf(c, 'w') === 'fill' ? each : sizes[i]))
}

function childHeights(node: LayoutNode, l: LayoutSpec, h: number, widths: number[]): number[] {
	const cs = kids(node)
	const inner = Math.max(0, h - l.padding[0] - l.padding[2])
	if (l.mode === 'horizontal' || l.mode === 'none') {
		return cs.map((c, i) => {
			const s = sizingOf(c, 'h')
			if (s === 'fill' || (l.mode === 'horizontal' && l.alignItems === 'stretch' && s === 'hug')) return inner
			if (s === 'hug') return naturalH(c, widths[i])
			return c.h
		})
	}
	const sizes = cs.map((c, i) => (sizingOf(c, 'h') === 'fill' ? 0 : naturalH(c, widths[i])))
	const fills = cs.filter((c) => sizingOf(c, 'h') === 'fill').length
	const used = sizes.reduce((a, b) => a + b, 0) + l.gap * Math.max(0, cs.length - 1)
	const each = share(inner - used, fills)
	return cs.map((c, i) => (sizingOf(c, 'h') === 'fill' ? each : sizes[i]))
}

function place(node: LayoutNode, w: number, h: number, out: Map<string, LayoutBox>) {
	const l = fullLayout(node)
	const cs = kids(node)
	if (!cs.length || !l) {
		for (const c of cs) out.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, w: c.w, h: c.h })
		return
	}
	const ws = childWidths(node, l, w)
	const hs = childHeights(node, l, h, ws)
	const [pt, pr, pb, pl] = l.padding
	if (l.mode === 'none') {
		cs.forEach((c, i) => {
			out.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, w: ws[i], h: hs[i] })
			place(c, ws[i], hs[i], out)
		})
		return
	}
	const vertical = l.mode === 'vertical'
	const mains = vertical ? hs : ws
	const crosses = vertical ? ws : hs
	const innerMain = vertical ? h - pt - pb : w - pl - pr
	const innerCross = vertical ? w - pl - pr : h - pt - pb
	const total = mains.reduce((a, b) => a + b, 0) + l.gap * Math.max(0, cs.length - 1)
	const free = innerMain - total
	let gap = l.gap
	let offset = 0
	if (l.justify === 'center') offset = free / 2
	else if (l.justify === 'end') offset = free
	else if (l.justify === 'space-between' && cs.length > 1 && free > 0) gap = l.gap + free / (cs.length - 1)
	else if (l.justify === 'space-between' && cs.length === 1) offset = 0
	let cursor = (vertical ? pt : pl) + offset
	cs.forEach((c, i) => {
		const slack = innerCross - crosses[i]
		// On a desktop page, a fixed-width block in the page column (product shot, CTA band) is centered, never flush left.
		const pageBlock = vertical && l.alignItems === 'stretch' && node.kind === 'screen' && w >= 1000 && sizingOf(c, 'w') === 'fixed' && slack > 1
		const crossOff = l.alignItems === 'center' || pageBlock ? slack / 2 : l.alignItems === 'end' ? slack : 0
		const crossPos = (vertical ? pl : pt) + crossOff
		const box = vertical
			? { x: crossPos, y: cursor, w: ws[i], h: hs[i] }
			: { x: cursor, y: crossPos, w: ws[i], h: hs[i] }
		out.set(c.id, roundBox(box))
		cursor += mains[i] + gap
		place(c, ws[i], hs[i], out)
	})
}

const r2 = (n: number) => Math.round(n * 100) / 100
const roundBox = (b: LayoutBox): LayoutBox => ({ x: r2(b.x), y: r2(b.y), w: r2(Math.max(0, b.w)), h: r2(Math.max(0, b.h)) })

/**
 * Figma-style auto layout. Returns the box of every node in the tree, x/y
 * relative to its parent (the root keeps its own x/y). Root 'fill' sizing has
 * no parent to fill, so it is treated as fixed.
 */
export function layoutTree(root: LayoutNode, opts: { measure?: TextMeasurer } = {}): Map<string, LayoutBox> {
	const previous = activeMeasurer
	activeMeasurer = opts.measure ?? estimateText
	try {
		const out = new Map<string, LayoutBox>()
		const w = sizingOf(root, 'w') === 'hug' ? naturalW(root) : root.w
		const h = sizingOf(root, 'h') === 'hug' ? naturalH(root, w) : root.h
		out.set(root.id, roundBox({ x: root.x ?? 0, y: root.y ?? 0, w, h }))
		place(root, w, h, out)
		return out
	} finally {
		activeMeasurer = previous
	}
}

// --------------------------------------------------------- normalization

/** A fully-resolved design node: shape props + layout meta + children. */
export type UiTreeNode = {
	id: string
	props: UiProps
	meta: UiMeta
	x: number
	y: number
	children: UiTreeNode[]
}

export function normalizePadding(p: unknown): [number, number, number, number] {
	const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0)
	if (typeof p === 'number') return pad(n(p))
	if (Array.isArray(p)) {
		if (p.length === 1) return pad(n(p[0]))
		if (p.length === 2) return [n(p[0]), n(p[1]), n(p[0]), n(p[1])]
		if (p.length === 3) return [n(p[0]), n(p[1]), n(p[2]), n(p[1])]
		if (p.length >= 4) return [n(p[0]), n(p[1]), n(p[2]), n(p[3])]
	}
	return [0, 0, 0, 0]
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)
const oneOf = <V extends string>(v: unknown, allowed: readonly V[]): V | undefined => (allowed.includes(v as V) ? (v as V) : undefined)

export const normalizeKind = (t: unknown): UiKind => {
	const s = String(t ?? '').toLowerCase()
	const alias: Record<string, UiKind> = { container: 'frame', stack: 'frame', row: 'frame', column: 'frame', label: 'text', heading: 'text', textfield: 'input', 'text-field': 'input', switch: 'toggle', img: 'image', separator: 'divider', box: 'rect', rectangle: 'rect' }
	return (UI_KINDS as readonly string[]).includes(s) ? (s as UiKind) : (alias[s] ?? 'frame')
}

/**
 * Applies the spec's fields (all optional) on top of existing props/meta.
 * Used both for creation (on top of kind defaults) and for update_node.
 */
export function applySpec(props: UiProps, meta: UiMeta, spec: Partial<UiNodeSpec>): { props: UiProps; meta: UiMeta } {
	const p: UiProps = { ...props }
	const m: UiMeta = { ...meta, sizing: { ...meta.sizing } }
	for (const k of ['name', 'text', 'icon', 'fill', 'textColor', 'stroke'] as const) {
		if (spec[k] !== undefined && spec[k] !== null) p[k] = String(spec[k])
	}
	for (const k of ['strokeWidth', 'radius', 'fontSize', 'fontWeight', 'opacity'] as const) {
		const v = num(spec[k])
		if (v !== undefined) p[k] = k === 'opacity' ? Math.min(1, Math.max(0, v)) : Math.max(0, v)
	}
	if (oneOf(spec.align, ['left', 'center', 'right'] as const)) p.align = spec.align!
	if (oneOf(spec.shadow, ['none', 'sm', 'md', 'lg'] as const)) p.shadow = spec.shadow!
	if (typeof spec.checked === 'boolean') p.checked = spec.checked
	if (p.icon && !ICON_PATHS[p.icon]) p.icon = ICONS.find((i) => p.icon.includes(i)) ?? 'star'
	if (p.kind === 'chart') {
		const chart = normalizeChart(spec as Record<string, any>, m.chart)
		if (chart) m.chart = chart
	}
	if (p.kind === 'screen' && (spec.tabs !== undefined || spec.activeTab !== undefined)) {
		const tabs = normalizeTabs(spec as Record<string, any>, m.tabs)
		if (tabs) m.tabs = tabs
		else delete m.tabs
	}
	if (spec.trailingIcon !== undefined && p.kind === 'input') {
		const t = String(spec.trailingIcon ?? '')
		if (t && t !== 'none') m.trailingIcon = ICON_PATHS[t] ? t : (ICONS.find((i) => t.includes(i)) ?? 'chevron-right')
		else delete m.trailingIcon
	}
	for (const [key, axis] of [['width', 'w'], ['height', 'h']] as const) {
		// A badge never stretches: 'fill' on a status pill means "the cell", so it hugs its label.
		const v = p.kind === 'badge' && spec[key] === 'fill' ? 'hug' : spec[key]
		if (v === 'fill' || v === 'hug') m.sizing[axis] = v
		else if (num(v) !== undefined) {
			m.sizing[axis] = 'fixed'
			p[axis] = Math.max(0, num(v)!)
		}
	}
	const layoutKeys = ['layout', 'gap', 'padding', 'alignItems', 'justify'] as const
	if (layoutKeys.some((k) => spec[k] !== undefined) && (isContainerKind(p.kind) || m.layout)) {
		const base: LayoutSpec = m.layout ?? vstack(12, 0)
		const l: LayoutSpec = { ...base, padding: [...base.padding] as LayoutSpec['padding'] }
		const mode = oneOf(spec.layout, ['vertical', 'horizontal', 'none'] as const)
		if (mode) {
			// Horizontal rows read best vertically centered unless told otherwise.
			if (mode !== l.mode && spec.alignItems === undefined) l.alignItems = mode === 'horizontal' ? 'center' : 'stretch'
			l.mode = mode
		}
		if (num(spec.gap) !== undefined) l.gap = Math.max(0, num(spec.gap)!)
		if (spec.padding !== undefined) l.padding = normalizePadding(spec.padding)
		const ai = oneOf(spec.alignItems, ['start', 'center', 'end', 'stretch'] as const)
		if (ai) l.alignItems = ai
		const j = oneOf(spec.justify, ['start', 'center', 'end', 'space-between'] as const)
		if (j) l.justify = j
		m.layout = l
	}
	return { props: p, meta: m }
}

/** Default props + meta for a kind. */
export function kindDefaults(kind: UiKind): { props: UiProps; meta: UiMeta } {
	const d = KIND_DEFAULTS[kind]
	return {
		props: { ...UI_DEFAULT_PROPS, ...d.props, kind },
		meta: { sizing: { ...d.sizing }, ...(d.layout ? { layout: { ...d.layout, padding: [...d.layout.padding] as LayoutSpec['padding'] } } : {}) },
	}
}

/**
 * Turns an agent node spec (recursively) into a resolved tree: kind defaults
 * applied, padding normalized, children ordered. `kind` overrides spec.type
 * (e.g. 'screen' for create_screen).
 */
export function specToTree(spec: UiNodeSpec, kind?: UiKind): UiTreeNode {
	spec = expandTemplates(spec)
	const k = kind ?? normalizeKind(spec.type)
	const base = kindDefaults(k)
	const { props, meta } = applySpec(base.props, base.meta, spec)
	if (!props.name) props.name = String(spec.id ?? '')
	const children = (isContainerKind(k) && Array.isArray(spec.children) ? spec.children : [])
		.filter((c) => c && typeof c === 'object')
		.map((c, i) => {
			const child = specToTree(c.type === 'screen' ? { ...c, type: 'frame' } : c)
			child.meta.order = i
			return child
		})
	// A row of panels (cards, a sidebar beside content) defaults to equal heights, like a row of cards should.
	if (meta.layout?.mode === 'horizontal' && spec.alignItems === undefined && children.length >= 2 && children.every((c) => isContainerKind(c.props.kind)) && children.some((c) => c.props.fill !== 'transparent' || c.props.stroke !== 'transparent')) {
		meta.layout = { ...meta.layout, alignItems: 'stretch' }
	}
	return { id: String(spec.id ?? ''), props, meta, x: num(spec.x) ?? 0, y: num(spec.y) ?? 0, children }
}

/**
 * Repeats a frame's `template` once per entry of `items` (replacing {key} in
 * every string with the entry's value; a field that is just "{key}" with no
 * value is dropped so the default applies). Generated ids get a _1, _2...
 * suffix. With `dividers`, a divider goes between rows. Lets the model write a
 * list, nav, stat row or table once instead of N times.
 */
export function expandTemplates(spec: UiNodeSpec): UiNodeSpec {
	if (!spec || typeof spec !== 'object') return spec
	let children = Array.isArray(spec.children) ? spec.children : undefined
	const tpl = spec.template
	if (tpl && typeof tpl === 'object' && Array.isArray(spec.items) && spec.items.length) {
		const base = String(tpl.id ?? `${spec.id}_item`)
		const generated: UiNodeSpec[] = []
		spec.items.slice(0, 40).forEach((item, i) => {
			const vars = item && typeof item === 'object' ? (item as Record<string, unknown>) : { text: item }
			if (i && spec.dividers) generated.push({ id: `${spec.id}_div_${i}`, type: 'divider' })
			generated.push(fillTemplate({ ...tpl, id: base }, vars, i + 1))
		})
		children = [...(children ?? []), ...generated]
	}
	const { template: _t, items: _i, dividers: _d, ...rest } = spec
	return children ? { ...rest, children: children.map((c) => expandTemplates(c)) } : rest
}

function fillTemplate(node: UiNodeSpec, vars: Record<string, unknown>, n: number): UiNodeSpec {
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(node)) {
		if (k === 'children' && Array.isArray(v)) out.children = v.map((c) => fillTemplate(c, vars, n))
		else if (k === 'id') out.id = `${String(v)}_${n}`
		else if (typeof v === 'string' && v.includes('{')) {
			const whole = /^\{(\w+)\}$/.exec(v)
			if (whole) {
				if (vars[whole[1]] !== undefined && vars[whole[1]] !== null) out[k] = vars[whole[1]]
			} else out[k] = v.replace(/\{(\w+)\}/g, (_, key) => (vars[key] === undefined || vars[key] === null ? '' : String(vars[key])))
		} else out[k] = v
	}
	return out as UiNodeSpec
}

/**
 * Padding the layout actually uses. Phone screens draw a status bar and home
 * indicator, and maybe a tab bar: content keeps clear of them (safe areas).
 */
export function effectivePadding(node: Pick<UiTreeNode, 'props' | 'meta'>): LayoutSpec['padding'] {
	const p = node.meta.layout?.padding ?? [0, 0, 0, 0]
	if (node.props.kind !== 'screen') return p
	const phone = isPhoneScreen(node.props.w, node.props.h)
	const [t, r, b, l] = p
	return [phone ? Math.max(t, 52) : t, r, node.meta.tabs ? Math.max(b, 98) : phone ? Math.max(b, 28) : b, l]
}

/** Converts a resolved tree into the plain tree layoutTree works on. */
export function toLayoutNode(node: UiTreeNode): LayoutNode {
	const layout = node.meta.layout ? { ...node.meta.layout, padding: effectivePadding(node) } : undefined
	return {
		id: node.id,
		kind: node.props.kind,
		w: node.props.w,
		h: node.props.h,
		x: node.x,
		y: node.y,
		text: node.props.text,
		icon: node.props.icon,
		fontSize: node.props.fontSize,
		fontWeight: node.props.fontWeight,
		sizing: node.meta.sizing,
		layout,
		children: [...node.children].sort((a, b) => (a.meta.order ?? 0) - (b.meta.order ?? 0)).map(toLayoutNode),
	}
}

/** Lays out a resolved tree in place (writes x/y/w/h) and returns it. */
export function layoutUiTree(root: UiTreeNode, opts: { measure?: TextMeasurer } = {}): UiTreeNode {
	const boxes = layoutTree(toLayoutNode(root), opts)
	const walk = (n: UiTreeNode) => {
		const b = boxes.get(n.id)
		if (b) Object.assign(n, { x: b.x, y: b.y }), Object.assign(n.props, { w: b.w, h: b.h })
		n.children.forEach(walk)
	}
	walk(root)
	return root
}

/** Initials for an avatar label. */
export const initials = (s: string) =>
	s
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => w[0]!.toUpperCase())
		.join('')

// Soft, layered elevation: a crisp contact shadow plus a wide ambient one.
export const SHADOWS: Record<UiShadow, string> = {
	none: 'none',
	sm: '0 1px 2px rgba(15,17,28,.05), 0 2px 8px -2px rgba(15,17,28,.06)',
	md: '0 1px 3px rgba(15,17,28,.06), 0 8px 24px -6px rgba(15,17,28,.12)',
	lg: '0 2px 6px rgba(15,17,28,.06), 0 24px 48px -12px rgba(15,17,28,.18)',
}

/** Display type tracks tighter (Inter): -0.02em at 24px+, -0.01em at 18px+. */
export const letterSpacingFor = (fontSize: number) => (fontSize >= 24 ? '-0.02em' : fontSize >= 18 ? '-0.01em' : 'normal')

// ------------------------------------------------------------- HTML export

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const cssColor = (v: string) => (v.startsWith('$') ? `var(--${v.slice(1)})` : v || 'transparent')
const FLEX_ALIGN: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', 'space-between': 'space-between' }

/** Brand marks are filled shapes (Google in its four colors), not stroked glyphs. */
export const FILLED_ICONS = new Set(['google', 'apple'])
const GOOGLE_COLORS = ['#4285F4', '#34A853', '#FBBC05', '#EA4335']
/** The <path> elements of an icon (24x24 box) in the given color. */
export function iconPaths(name: string, color: string, strokeWidth = 2): string {
	const d = ICON_PATHS[name] ?? ICON_PATHS.star
	if (name === 'google') return d.split(/(?= M)/).map((part, i) => `<path d="${part.trim()}" fill="${GOOGLE_COLORS[i % 4]}"/>`).join('')
	if (FILLED_ICONS.has(name)) return `<path d="${d}" fill="${color}"/>`
	return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
}

export function iconSvg(name: string, size: number, color: string): string {
	if (FILLED_ICONS.has(name)) return `<svg width="${size}" height="${size}" viewBox="0 0 24 24">${iconPaths(name, color)}</svg>`
	const d = ICON_PATHS[name] ?? ICON_PATHS.star
	return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`
}

/**
 * Standalone HTML/CSS for a resolved tree (usually a screen). Auto layout maps
 * to flexbox, sizing to flex/width rules, tokens to CSS variables.
 */
export function treeToHtml(tree: UiTreeNode, theme: Partial<ThemeSpec> = tree.meta.theme ?? DEFAULT_THEME): string {
	const vars = TOKENS.map((t) => `--${t}: ${resolveColor('$' + t, theme)};`).join(' ')
	const node = (n: UiTreeNode, parent: LayoutSpec | null, inPage = false): string => {
		const p = n.props
		const s: string[] = []
		// Same rule as the layout engine: fixed-width blocks in a desktop page column are centered.
		if (inPage && parent?.mode === 'vertical' && parent.alignItems === 'stretch' && n.meta.sizing.w === 'fixed') s.push('align-self: center')
		const sz = n.meta.sizing
		const dirMain = parent?.mode === 'horizontal' ? 'w' : 'h'
		for (const axis of ['w', 'h'] as const) {
			const prop = axis === 'w' ? 'width' : 'height'
			const mode = parent ? sz[axis] : 'fixed'
			if (mode === 'fixed') s.push(`${prop}: ${Math.round(p[axis])}px`, `flex-shrink: 0`)
			else if (mode === 'fill' && parent && parent.mode !== 'none') {
				if (axis === dirMain) s.push('flex: 1 1 0')
				else s.push('align-self: stretch')
			}
		}
		if (parent?.mode === 'none') s.push('position: absolute', `left: ${Math.round(n.x)}px`, `top: ${Math.round(n.y)}px`)
		const l = n.meta.layout
		if (l) {
			if (l.mode === 'none') s.push('position: relative')
			else s.push('display: flex', `flex-direction: ${l.mode === 'horizontal' ? 'row' : 'column'}`, `gap: ${l.gap}px`, `align-items: ${FLEX_ALIGN[l.alignItems]}`, `justify-content: ${FLEX_ALIGN[l.justify]}`)
			s.push(`padding: ${effectivePadding(n).map((v) => `${v}px`).join(' ')}`)
		}
		if (p.fill !== 'transparent' && p.kind !== 'toggle' && p.kind !== 'checkbox' && p.kind !== 'image') s.push(`background: ${cssColor(p.fill)}`)
		if (p.kind === 'icon' || p.kind === 'badge') s.push('display: inline-flex', 'align-items: center', 'justify-content: center')
		if (p.stroke !== 'transparent') s.push(`border: ${p.strokeWidth}px solid ${cssColor(p.stroke)}`)
		if (p.radius) s.push(`border-radius: ${p.radius}px`)
		if (p.kind === 'avatar') s.push('border-radius: 50%', 'display: flex', 'align-items: center', 'justify-content: center')
		if (p.shadow !== 'none') s.push(`box-shadow: ${SHADOWS[p.shadow]}`)
		if (p.opacity !== 1) s.push(`opacity: ${p.opacity}`)
		if (['text', 'button', 'input', 'checkbox', 'avatar', 'badge'].includes(p.kind)) {
			s.push(`color: ${cssColor(p.textColor)}`, `font-size: ${p.fontSize}px`, `font-weight: ${p.fontWeight}`, `line-height: ${LINE_HEIGHT}`)
			if (letterSpacingFor(p.fontSize) !== 'normal') s.push(`letter-spacing: ${letterSpacingFor(p.fontSize)}`)
			if (p.kind === 'text') s.push(`text-align: ${p.align}`, 'margin: 0')
		}
		if (p.kind === 'screen') s.push('overflow: hidden', 'box-sizing: border-box', 'position: relative')
		if (p.kind === 'image') s.push('overflow: hidden', 'position: relative')
		const style = `style="${s.join('; ')}"`
		const label = esc(p.text)
		const icon = (size: number, color: string) => (p.icon ? iconSvg(p.icon, size, color) : '')
		const childParent = l ?? null
		switch (p.kind) {
			case 'text':
				return `<p ${style}>${label}</p>`
			case 'button':
				return `<button ${style}>${icon(Math.round(p.fontSize * 1.25), 'currentColor')}${label}</button>`
			case 'badge':
				return `<span ${style}>${icon(Math.round(p.fontSize), 'currentColor')}${label}</span>`
			case 'input':
				return `<label ${style}>${icon(20, 'var(--muted)')}<input placeholder="${label}" style="all: unset; flex: 1; color: var(--text)" />${n.meta.trailingIcon ? iconSvg(n.meta.trailingIcon, 20, 'var(--muted)') : ''}</label>`
			case 'image':
				return `<div ${style} role="img" aria-label="${label || 'image'}">${artSvg(n.id, p.w, p.h, theme, p.text)}${p.icon ? `<span style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center">${iconSvg(p.icon, 28, '#ffffff')}</span>` : ''}</div>`
			case 'chart':
				return `<div ${style} role="img" aria-label="${esc(p.name || 'chart')}">${n.meta.chart ? chartSvg(n.meta.chart, p.w, p.h, theme, n.id) : ''}</div>`
			case 'icon':
				return `<span ${style}>${iconSvg(p.icon, Math.round(Math.min(p.w, p.h) * (p.fill === 'transparent' ? 1 : 0.55)), cssColor(p.textColor))}</span>`
			case 'avatar':
				return `<div ${style}>${p.icon ? icon(Math.round(p.w * 0.5), 'currentColor') : esc(initials(p.text || p.name))}</div>`
			case 'toggle':
				return `<input type="checkbox" role="switch" ${p.checked ? 'checked ' : ''}${style} />`
			case 'checkbox':
				return `<label ${style}><input type="checkbox" ${p.checked ? 'checked ' : ''}style="accent-color: ${cssColor(p.fill)}; width: 18px; height: 18px; margin: 0 10px 0 0" />${label}</label>`
			case 'divider':
				return `<hr ${style.replace('style="', 'style="border: 0; margin: 0; ')} />`
			default: {
				const inner = [...n.children].sort((a, b) => (a.meta.order ?? 0) - (b.meta.order ?? 0)).map((c) => node(c, childParent, p.kind === 'screen' && p.w >= 1000)).join('\n')
				let chrome = ''
				if (p.kind === 'screen') {
					const ink = resolveColor('$text', theme)
					const at = (pos: string, svg: string) => `<div style="position: absolute; left: 0; ${pos}: 0; line-height: 0">${svg}</div>`
					if (isPhoneScreen(p.w, p.h)) chrome += at('top', statusBarSvg(p.w, ink))
					if (n.meta.tabs) chrome += at('bottom', tabBarSvg(p.w, n.meta.tabs, theme))
					if (isPhoneScreen(p.w, p.h)) chrome += at('bottom', homeIndicatorSvg(p.w, ink))
				}
				return `<div data-name="${esc(p.name)}" ${style}>\n${chrome}${inner}\n</div>`
			}
		}
	}
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(tree.props.name || tree.id)}</title>
<style>
:root { ${vars} }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #e9eaee; font-family: Inter, system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }
button { border: 0; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-family: inherit; }
label { display: flex; align-items: center; gap: 10px; }
input[role="switch"] { appearance: none; position: relative; border-radius: 999px; background: var(--surfaceAlt); box-shadow: inset 0 0 0 1px var(--border); margin: 0; }
input[role="switch"]:checked { background: var(--primary); box-shadow: none; }
input[role="switch"]::after { content: ""; position: absolute; top: 2px; left: 2px; width: calc(100% / 2 - 4px); aspect-ratio: 1; height: calc(100% - 4px); border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.2); transition: left .15s; }
input[role="switch"]:checked::after { left: calc(100% - (100% / 2 - 4px) - 2px); }
</style>
</head>
<body>
${node(tree, null)}
</body>
</html>
`
}
