// Generated visuals for design nodes, as SVG strings shared by the canvas
// renderer (client/src/design/UiShapeUtil.tsx) and the HTML export
// (treeToHtml): charts, image art, the phone status bar and tab bar.
// Everything is pure and resolved against the screen's theme (never the OS
// color scheme), so PNG exports and dark screens render exactly as on canvas.

import { contrast, ICON_PATHS, mixHex, parseHex, resolveColor, type ThemeSpec } from './design.ts'

const FONT = "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const r1 = (n: number) => Math.round(n * 10) / 10
const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_')

// ------------------------------------------------------------------ color helpers

function hexToHsl(hex: string): [number, number, number] {
	const [r, g, b] = (parseHex(hex) ?? [91, 91, 214]).map((v) => v / 255)
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const l = (max + min) / 2
	if (max === min) return [0, 0, l]
	const d = max - min
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
	const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
	return [h * 60, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
	const k = (n: number) => (n + h / 30) % 12
	const a = s * Math.min(l, 1 - l)
	const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
	return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
}

/** The brand color rotated around the hue wheel (analogous accents for art). */
export function hueShift(hex: string, deg: number, sat = 1): string {
	const [h, s, l] = hexToHsl(hex)
	return hslToHex((((h + deg) % 360) + 360) % 360, Math.min(1, s * sat), l)
}

/** A tint of `color` toward `bg`, as soft as possible while keeping `min` contrast against `bg`. */
export function tintWithContrast(color: string, bg: string, min: number, softest = 0.7): string {
	if (!parseHex(color) || !parseHex(bg)) return color
	for (let t = softest; t > 0; t -= 0.05) {
		const c = mixHex(color, bg, t)
		if (contrast(c, bg) >= min) return c
	}
	return color
}

const hash = (s: string) => {
	let h = 2166136261
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
	return h >>> 0
}

// ------------------------------------------------------------------ charts

export type ChartType = 'bar' | 'line'
export type ChartSpec = { type: ChartType; data: number[]; labels: string[]; highlight?: number; prefix?: string; suffix?: string }

const DEFAULT_CHART: ChartSpec = { type: 'bar', data: [32, 45, 38, 52, 48, 61, 57, 72], labels: [] }

/** Reads chart fields from a node spec (chart, data, labels, highlight, prefix, suffix) on top of the previous chart. */
export function normalizeChart(spec: Record<string, any>, prev?: ChartSpec): ChartSpec | undefined {
	const keys = ['chart', 'data', 'labels', 'highlight', 'prefix', 'suffix']
	if (!keys.some((k) => spec[k] !== undefined) && prev) return prev
	const base = prev ?? DEFAULT_CHART
	const type: ChartType = spec.chart === 'line' || spec.chart === 'area' ? 'line' : spec.chart === 'bar' ? 'bar' : base.type
	const data = Array.isArray(spec.data)
		? spec.data.map((v: unknown) => Number(typeof v === 'string' ? v.replace(/[^0-9.-]/g, '') : v)).filter((v: number) => Number.isFinite(v)).slice(0, 24)
		: base.data
	const labels = Array.isArray(spec.labels) ? spec.labels.map((l: unknown) => String(l ?? '').slice(0, 8)).slice(0, 24) : base.labels
	const highlight = Number.isInteger(spec.highlight) ? Number(spec.highlight) : spec.highlight === null ? undefined : base.highlight
	const out: ChartSpec = { type, data: data.length >= 2 ? data : base.data, labels }
	if (highlight !== undefined) out.highlight = highlight
	const prefix = typeof spec.prefix === 'string' ? spec.prefix.slice(0, 3) : base.prefix
	const suffix = typeof spec.suffix === 'string' ? spec.suffix.slice(0, 4) : base.suffix
	if (prefix) out.prefix = prefix
	if (suffix) out.suffix = suffix
	return out
}

/** 1234 -> 1.2k, 56000 -> 56k, 2400000 -> 2.4M. */
export function compactNumber(v: number): string {
	const a = Math.abs(v)
	const trim = (s: string) => s.replace(/\.0$/, '')
	if (a >= 1e6) return trim((v / 1e6).toFixed(a >= 1e7 ? 0 : 1)) + 'M'
	if (a >= 1e3) return trim((v / 1e3).toFixed(a >= 1e4 ? 0 : 1)) + 'k'
	return a >= 10 || Number.isInteger(v) ? String(Math.round(v)) : trim(v.toFixed(1))
}

function niceStep(x: number): number {
	if (!(x > 0)) return 1
	const e = 10 ** Math.floor(Math.log10(x))
	const f = x / e
	return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e
}

/** Four gridlines (lo + i * step, i = 0..3) that contain the data. */
function chartScale(data: number[], line: boolean): { lo: number; step: number } {
	const max = Math.max(...data, 0)
	const min = Math.min(...data)
	// Bars start at zero; a line of values in a narrow band gets a baseline under its minimum.
	let lo = line && min > 0 && (max - min) / max < 0.6 ? min - (max - min) * 0.25 : Math.min(0, min)
	let step = niceStep((max - lo) / 3 || 1)
	for (let i = 0; i < 6; i++) {
		const l = Math.floor(lo / step) * step
		if (l + step * 3 >= max) return { lo: l, step }
		step = niceStep(step * 1.05)
	}
	lo = Math.floor(lo / step) * step
	return { lo, step }
}

/** Catmull-Rom spline through the points, as cubic Bézier segments. */
function smoothPath(pts: [number, number][]): string {
	if (pts.length < 2) return ''
	let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`
	for (let i = 0; i < pts.length - 1; i++) {
		const p0 = pts[i - 1] ?? pts[i]
		const p1 = pts[i]
		const p2 = pts[i + 1]
		const p3 = pts[i + 2] ?? p2
		const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
		const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
		d += ` C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p2[0])} ${r1(p2[1])}`
	}
	return d
}

/**
 * A bar or line chart sized w x h: four labelled gridlines, x-axis labels, the
 * highlighted (default: peak) value marked in the brand color with its value
 * label. Sits on a $surface card.
 */
export function chartSvg(spec: ChartSpec, w: number, h: number, theme: Partial<ThemeSpec>, uid = 'chart'): string {
	const id = safeId(uid)
	const dark = theme.mode === 'dark'
	const c = (t: string) => resolveColor(t, theme)
	const surface = c('$surface')
	const primary = c('$primary')
	const muted = c('$muted')
	const grid = dark ? mixHex(c('$border'), surface, 0.15) : c('$border')
	const data = spec.data.length >= 2 ? spec.data : DEFAULT_CHART.data
	const n = data.length
	const line = spec.type === 'line'
	const { lo, step } = chartScale(data, line)
	const hi = lo + step * 3
	const fmt = (v: number) => `${spec.prefix ?? ''}${compactNumber(v)}${spec.suffix ?? ''}`
	const ticks = [0, 1, 2, 3].map((i) => lo + step * i)
	const tickLabels = ticks.map(fmt)
	const hasLabels = spec.labels.some(Boolean)
	const padL = Math.max(...tickLabels.map((t) => t.length)) * 6.6 + 12
	const padT = 30
	const padB = hasLabels ? 26 : 8
	const x0 = padL
	const x1 = w - 4
	const y0 = padT
	const y1 = Math.max(y0 + 20, h - padB)
	const yOf = (v: number) => y1 - ((Math.max(lo, v) - lo) / (hi - lo || 1)) * (y1 - y0)
	const hl = Number.isInteger(spec.highlight) && spec.highlight! >= 0 && spec.highlight! < n ? spec.highlight! : data.indexOf(Math.max(...data))
	const parts: string[] = []
	// Gridlines + y labels.
	ticks.forEach((t, i) => {
		const y = r1(yOf(t)) + 0.5
		parts.push(`<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="${grid}" stroke-width="1"${i ? ' stroke-dasharray="3 5"' : ''}/>`)
		parts.push(`<text x="${x0 - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="${muted}">${esc(tickLabels[i])}</text>`)
	})
	const slot = (x1 - x0) / n
	const xCenter = (i: number) => (line ? x0 + 8 + (i * (x1 - x0 - 16)) / Math.max(1, n - 1) : x0 + slot * (i + 0.5))
	// X labels (every other one when they would collide).
	if (hasLabels) {
		const widest = Math.max(...spec.labels.map((l) => l.length)) * 6.4 + 8
		const every = Math.max(1, Math.ceil(widest / ((x1 - x0) / n)))
		spec.labels.slice(0, n).forEach((l, i) => {
			if (!l || (i % every && i !== hl)) return
			parts.push(`<text x="${r1(xCenter(i))}" y="${h - 6}" text-anchor="middle" font-size="11" fill="${i === hl ? c('$text') : muted}"${i === hl ? ' font-weight="600"' : ''}>${esc(l)}</text>`)
		})
	}
	let peak: [number, number]
	if (line) {
		const pts = data.map((v, i) => [xCenter(i), yOf(v)] as [number, number])
		const d = smoothPath(pts)
		parts.push(
			`<defs><linearGradient id="${id}-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${primary}" stop-opacity="${dark ? 0.32 : 0.2}"/><stop offset="1" stop-color="${primary}" stop-opacity="0"/></linearGradient></defs>`,
			`<path d="${d} L${r1(pts[n - 1][0])} ${y1} L${r1(pts[0][0])} ${y1} Z" fill="url(#${id}-area)"/>`,
			`<path d="${d}" fill="none" stroke="${primary}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
			`<line x1="${r1(pts[hl][0])}" x2="${r1(pts[hl][0])}" y1="${r1(pts[hl][1])}" y2="${y1}" stroke="${primary}" stroke-opacity=".35" stroke-dasharray="3 4"/>`,
			`<circle cx="${r1(pts[hl][0])}" cy="${r1(pts[hl][1])}" r="5" fill="${surface}" stroke="${primary}" stroke-width="2.5"/>`
		)
		peak = [pts[hl][0], pts[hl][1] - 10]
	} else {
		// Resting bars: a brand tint that still reads on the card (>= 2:1); the highlight is the full brand color.
		const soft = tintWithContrast(primary, surface, dark ? 2 : 1.6, dark ? 0.55 : 0.68)
		const bw = Math.min(slot * 0.58, 44)
		data.forEach((v, i) => {
			const x = xCenter(i) - bw / 2
			const top = yOf(v)
			const bh = Math.max(2, y1 - top)
			const r = Math.min(6, bw / 2, bh)
			const yTop = y1 - bh
			parts.push(
				`<path d="M${r1(x)} ${y1} V${r1(yTop + r)} Q${r1(x)} ${r1(yTop)} ${r1(x + r)} ${r1(yTop)} H${r1(x + bw - r)} Q${r1(x + bw)} ${r1(yTop)} ${r1(x + bw)} ${r1(yTop + r)} V${y1} Z" fill="${i === hl ? primary : soft}"/>`
			)
		})
		peak = [xCenter(hl), yOf(data[hl]) - 8]
	}
	// Value label on the highlighted point.
	const label = fmt(data[hl])
	const pw = label.length * 6.8 + 16
	const px = Math.min(Math.max(peak[0] - pw / 2, x0), x1 - pw)
	const py = Math.max(2, peak[1] - 22)
	parts.push(
		`<rect x="${r1(px)}" y="${r1(py)}" width="${r1(pw)}" height="22" rx="11" fill="${primary}"/>`,
		`<text x="${r1(px + pw / 2)}" y="${r1(py + 15)}" text-anchor="middle" font-size="11" font-weight="600" fill="${c('$onPrimary')}">${esc(label)}</text>`
	)
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${r1(w)}" height="${r1(h)}" viewBox="0 0 ${r1(w)} ${r1(h)}" font-family="${esc(FONT)}" style="display:block">${parts.join('')}</svg>`
}

// ------------------------------------------------------------------ image art

export type ArtStyle = 'mesh' | 'rings' | 'horizon'

/** Picks an art style from the image's description, or from its id. */
export function artStyleFor(seed: string, text = ''): ArtStyle {
	const t = text.toLowerCase()
	if (/sun|dawn|dusk|sky|lake|mountain|hill|landscape|horizon|nature|travel|outdoor|sea|ocean|beach|calm|meditat|sleep|breath/.test(t)) return 'horizon'
	if (/ring|orbit|focus|sound|audio|music|pulse|signal|circle/.test(t)) return 'rings'
	return (['mesh', 'rings', 'horizon'] as const)[hash(seed) % 3]
}

/**
 * Abstract, themed placeholder art in the brand's hues: a soft mesh of
 * gradient blobs, concentric rings, or a sun over layered hills. Deterministic
 * per node id, so a screen looks the same on every render and export.
 */
export function artSvg(seed: string, w: number, h: number, theme: Partial<ThemeSpec>, text = ''): string {
	const id = safeId(`art-${seed}`)
	const dark = theme.mode === 'dark'
	const primary = resolveColor('$primary', theme)
	const p = parseHex(primary) ? primary : '#5b5bd6'
	const a2 = hueShift(p, 38, 0.9)
	const a3 = hueShift(p, -42, 0.9)
	const ink = dark ? '#0b0c0f' : '#ffffff'
	const style = artStyleFor(seed, text)
	const rnd = (() => {
		let s = hash(seed) || 1
		return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296
	})()
	const W = r1(w)
	const H = r1(h)
	const m = Math.max(w, h)
	const defs: string[] = []
	const body: string[] = []
	const blob = (key: string, cx: number, cy: number, r: number, color: string, op: number) => {
		defs.push(`<radialGradient id="${id}-${key}"><stop offset="0" stop-color="${color}" stop-opacity="${op}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`)
		body.push(`<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="url(#${id}-${key})"/>`)
	}
	const base = (top: string, bottom: string) => {
		defs.push(`<linearGradient id="${id}-bg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`)
		body.push(`<rect width="${W}" height="${H}" fill="url(#${id}-bg)"/>`)
	}
	if (style === 'horizon') {
		base(mixHex(a2, ink, dark ? 0.72 : 0.8), mixHex(p, ink, dark ? 0.6 : 0.88))
		const sx = w * (0.55 + rnd() * 0.2)
		const sy = h * 0.44
		const sr = Math.min(w, h) * 0.15
		const sun = dark ? mixHex(a2, '#ffffff', 0.55) : mixHex(a2, '#ffffff', 0.35)
		blob('glow', sx, sy, sr * 3.2, sun, dark ? 0.35 : 0.55)
		body.push(`<circle cx="${r1(sx)}" cy="${r1(sy)}" r="${r1(sr)}" fill="${sun}"/>`)
		const hill = (y: number, amp: number, phase: number, color: string) => {
			const pts: string[] = []
			const steps = 6
			for (let i = 0; i <= steps; i++) {
				const x = (w * i) / steps
				const yy = y + Math.sin(i * 1.1 + phase) * amp
				pts.push(`${r1(x)} ${r1(yy)}`)
			}
			// Smooth the ridge with quadratic midpoints.
			const xy = pts.map((s) => s.split(' ').map(Number))
			let d = `M0 ${H} L${xy[0][0]} ${xy[0][1]}`
			for (let i = 1; i < xy.length; i++) {
				const mx = (xy[i - 1][0] + xy[i][0]) / 2
				const my = (xy[i - 1][1] + xy[i][1]) / 2
				d += ` Q${xy[i - 1][0]} ${xy[i - 1][1]} ${r1(mx)} ${r1(my)}`
			}
			d += ` L${W} ${xy.at(-1)![1]} L${W} ${H} Z`
			body.push(`<path d="${d}" fill="${color}"/>`)
		}
		const ph = rnd() * 3
		hill(h * 0.62, h * 0.04, ph, mixHex(p, ink, dark ? 0.55 : 0.62))
		hill(h * 0.72, h * 0.05, ph + 2, mixHex(p, ink, dark ? 0.35 : 0.38))
		hill(h * 0.84, h * 0.04, ph + 4, dark ? mixHex(p, ink, 0.15) : p)
	} else if (style === 'rings') {
		base(mixHex(p, ink, dark ? 0.7 : 0.84), mixHex(a3, ink, dark ? 0.62 : 0.86))
		const cx = w * (0.4 + rnd() * 0.2)
		const cy = h * (0.42 + rnd() * 0.16)
		blob('b1', cx, cy, m * 0.55, p, dark ? 0.55 : 0.45)
		blob('b2', w * rnd(), h * (0.8 + rnd() * 0.2), m * 0.45, a2, dark ? 0.4 : 0.5)
		const ring = dark ? '#ffffff' : '#ffffff'
		for (let i = 1; i <= 5; i++) {
			const r = Math.min(w, h) * 0.11 * i
			body.push(`<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="none" stroke="${ring}" stroke-opacity="${r1(0.55 - i * 0.08)}" stroke-width="${i === 1 ? 2 : 1.25}"/>`)
		}
		body.push(`<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(Math.min(w, h) * 0.06)}" fill="${dark ? mixHex(p, '#ffffff', 0.25) : p}"/>`)
	} else {
		base(mixHex(p, ink, dark ? 0.7 : 0.86), mixHex(a2, ink, dark ? 0.66 : 0.88))
		blob('b1', w * (0.15 + rnd() * 0.25), h * (0.2 + rnd() * 0.2), m * 0.6, p, dark ? 0.6 : 0.5)
		blob('b2', w * (0.65 + rnd() * 0.3), h * (0.25 + rnd() * 0.3), m * 0.5, a2, dark ? 0.5 : 0.55)
		blob('b3', w * (0.35 + rnd() * 0.3), h * (0.75 + rnd() * 0.25), m * 0.55, a3, dark ? 0.45 : 0.45)
		blob('b4', w * rnd(), h * rnd() * 0.5, m * 0.3, dark ? p : '#ffffff', dark ? 0.25 : 0.7)
		// A couple of fine arcs give the wash some structure.
		const cx = w * (0.6 + rnd() * 0.3)
		const cy = h * (0.9 + rnd() * 0.3)
		for (let i = 1; i <= 3; i++) {
			body.push(`<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(m * 0.22 * i)}" fill="none" stroke="#ffffff" stroke-opacity="${dark ? 0.08 : 0.35}" stroke-width="1"/>`)
		}
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block"><defs>${defs.join('')}</defs>${body.join('')}</svg>`
}

// ------------------------------------------------------------------ phone chrome

/** Phone-sized screens get a status bar and home indicator (drawn by the screen, not nodes). */
export const isPhoneScreen = (w: number, h: number) => w <= 440 && h >= 640
export const STATUS_BAR_H = 50
export const TAB_BAR_H = 82

/** iOS-style status bar (9:41, signal, wifi, battery) in the screen's text color. */
export function statusBarSvg(w: number, color: string): string {
	const tx = Math.round(w * 0.14)
	const rx = w - 28
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${STATUS_BAR_H}" viewBox="0 0 ${w} ${STATUS_BAR_H}" style="display:block" font-family="${esc(FONT)}">
<text x="${tx}" y="32" text-anchor="middle" font-size="16" font-weight="600" fill="${color}" letter-spacing="-0.2">9:41</text>
<g fill="${color}">
<rect x="${rx - 70}" y="26" width="3" height="5" rx="1"/><rect x="${rx - 65}" y="24" width="3" height="7" rx="1"/><rect x="${rx - 60}" y="21.5" width="3" height="9.5" rx="1"/><rect x="${rx - 55}" y="19" width="3" height="12" rx="1"/>
<path d="M${rx - 42.5} 21.2a10.5 10.5 0 0 1 15 0l-1.6 1.6a8.2 8.2 0 0 0-11.8 0z M${rx - 39.6} 24.1a6.4 6.4 0 0 1 9.2 0l-1.6 1.6a4.1 4.1 0 0 0-6 0z M${rx - 36.7} 27l2.2-2.2 2.2 2.2-2.2 2.2z"/>
<rect x="${rx - 22}" y="19.5" width="24" height="12" rx="3.5" fill="none" stroke="${color}" stroke-opacity=".4" stroke-width="1"/>
<rect x="${rx - 20}" y="21.5" width="18" height="8" rx="2"/>
<rect x="${rx + 3}" y="23.5" width="1.5" height="4" rx=".75" fill-opacity=".45"/>
</g></svg>`
}

export function homeIndicatorSvg(w: number, color: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="21" viewBox="0 0 ${w} 21" style="display:block"><rect x="${r1((w - 134) / 2)}" y="8" width="134" height="5" rx="2.5" fill="${color}"/></svg>`
}

export type TabItem = { icon: string; label: string }
export type TabsSpec = { items: TabItem[]; active: number }

/** Reads `tabs` (array of {icon,label} or "label" strings, or [] / false to remove) and `activeTab` from a screen spec. */
export function normalizeTabs(spec: Record<string, any>, prev?: TabsSpec): TabsSpec | undefined {
	if (spec.tabs === false || (Array.isArray(spec.tabs) && !spec.tabs.length)) return undefined
	let items = prev?.items
	if (Array.isArray(spec.tabs)) {
		items = spec.tabs
			.map((t: any) => (typeof t === 'string' ? { icon: 'home', label: t } : { icon: String(t?.icon ?? 'home'), label: String(t?.label ?? t?.text ?? '') }))
			.map((t: TabItem) => ({ icon: ICON_PATHS[t.icon] ? t.icon : 'home', label: t.label.slice(0, 12) }))
			.slice(0, 5)
	}
	if (!items?.length) return undefined
	const active = Number.isInteger(spec.activeTab) ? Number(spec.activeTab) : (prev?.active ?? 0)
	return { items, active: Math.max(0, Math.min(items.length - 1, active)) }
}

/** A bottom tab bar (icons + 11px labels, the active one in the brand color), TAB_BAR_H tall. */
export function tabBarSvg(w: number, tabs: TabsSpec, theme: Partial<ThemeSpec>): string {
	const c = (t: string) => resolveColor(t, theme)
	const n = tabs.items.length
	const slot = w / n
	const items = tabs.items
		.map((t, i) => {
			const cx = slot * (i + 0.5)
			const color = i === tabs.active ? c('$primary') : c('$muted')
			return `<g transform="translate(${r1(cx - 12)} 10)"><path d="${ICON_PATHS[t.icon] ?? ICON_PATHS.home}" fill="none" stroke="${color}" stroke-width="${i === tabs.active ? 2.2 : 1.8}" stroke-linecap="round" stroke-linejoin="round"/></g><text x="${r1(cx)}" y="50" text-anchor="middle" font-size="11" font-weight="${i === tabs.active ? 600 : 500}" fill="${color}">${esc(t.label)}</text>`
		})
		.join('')
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${TAB_BAR_H}" viewBox="0 0 ${w} ${TAB_BAR_H}" style="display:block" font-family="${esc(FONT)}"><rect width="${w}" height="${TAB_BAR_H}" fill="${c('$surface')}"/><rect width="${w}" height="1" fill="${c('$border')}"/>${items}</svg>`
}
