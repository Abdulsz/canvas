// The launch video's shared look: the stage, the captions and the browser
// window frame. Every scene in ./scenes imports these so they all match.
// Development only (Clipmunk studio and export); nothing in the app imports it.
import { Surface, useSceneTime } from 'clipmunk'
import type { ReactNode } from 'react'

export const W = 1920
export const H = 1080
/** The app's accent hue (the welcome glow and agent gradient), used for the glow and key words. */
export const ACCENT = '#5e5ce6'
/** The app's own font (@fontsource-variable/inter, loaded by main.tsx). */
export const FONT = "'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif"
export const INK = '#f5f5f7'
export const INK_2 = 'rgba(245, 245, 247, 0.62)'

/** The app is shown at a smaller viewport and scaled up to fill the frame. */
export const APP_W = 1280
export const APP_H = 660
export const BAR_H = 44
export const WIN_W = APP_W
export const WIN_H = APP_H + BAR_H
/** Resting scale of the window Surface: 1536 x 845 on the 1920 x 1080 frame. */
export const WIN_SCALE = 1.2
/** Window layout box (centered horizontally, its scaled box ends ~26px above the bottom). */
export const WIN_LEFT = (W - WIN_W) / 2
export const WIN_TOP = 280

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const easeOut = (v: number) => 1 - Math.pow(1 - clamp01(v), 3)

/** Progress 0..1 of [start, start + dur] on the scene clock. */
export function progress(t: number, start: number, dur: number) {
	return clamp01((t - start) / dur)
}

/** The near-black stage with a faint glow of the accent. Absolutely positioned, inset 0, so it is drawn. */
function Backdrop() {
	return (
		<div
			style={{
				position: 'absolute',
				inset: 0,
				background: `radial-gradient(60% 55% at 50% 58%, ${ACCENT}2e 0%, ${ACCENT}10 45%, transparent 75%), radial-gradient(40% 30% at 50% 0%, ${ACCENT}14 0%, transparent 70%), #050507`,
			}}
		/>
	)
}

/** The root group: the 1920 x 1080 stage. Its background is the group's content plane at z 0. */
export function Stage({ children }: { children?: ReactNode }) {
	return (
		<Surface id="stage" content={<Backdrop />} style={{ position: 'relative', width: W, height: H, fontFamily: FONT, color: INK }}>
			{children}
		</Surface>
	)
}

/** Words that rise and fade in one after another; words in `keys` are in the accent. */
export function Words({ text, keys = [], start = 150, stagger = 85, dur = 520, rise = 26, keyColor = ACCENT }: { text: string; keys?: string[]; start?: number; stagger?: number; dur?: number; rise?: number; keyColor?: string }) {
	const t = useSceneTime()
	const words = text.split(' ')
	return (
		<>
			{words.map((w, i) => {
				const p = easeOut(progress(t, start + i * stagger, dur))
				const key = keys.includes(w.replace(/[.,!?]/g, ''))
				return (
					<span
						key={i}
						style={{
							display: 'inline-block',
							whiteSpace: 'pre',
							opacity: p,
							transform: `translateY(${(1 - p) * rise}px)`,
							color: key ? keyColor : undefined,
						}}
					>
						{w}
						{i < words.length - 1 ? ' ' : ''}
					</span>
				)
			})}
		</>
	)
}

/** The caption at the top of a feature scene (a leaf Surface, so its word motion stays flat). */
export function Caption({ text, keys, start }: { text: string; keys: string[]; start?: number }) {
	return (
		<Surface
			id="caption"
			style={{ position: 'absolute', left: 0, top: 66, width: W, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
		>
			<div style={{ fontSize: 68, fontWeight: 650, letterSpacing: '-0.035em', lineHeight: 1.05, textAlign: 'center' }}>
				<Words text={text} keys={keys} start={start} />
			</div>
		</Surface>
	)
}

/** Three dots and the page's URL in a title bar, then the page. No shadows. */
export function BrowserWindow({ url, children }: { url: string; children: ReactNode }) {
	return (
		<Surface id="window" style={{ position: 'absolute', left: WIN_LEFT, top: WIN_TOP, width: WIN_W, height: WIN_H }}>
			<div
				style={{
					width: WIN_W,
					height: WIN_H,
					borderRadius: 14,
					overflow: 'hidden',
					background: '#1c1c1f',
					outline: '1px solid rgba(255,255,255,0.12)',
					display: 'flex',
					flexDirection: 'column',
				}}
			>
				<div style={{ height: BAR_H, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8, background: '#1c1c1f', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
					{['#ff5f57', '#febc2e', '#28c840'].map((c) => (
						<span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
					))}
					<div style={{ flex: 1, display: 'flex', justifyContent: 'center', paddingRight: 52 }}>
						<div
							style={{
								minWidth: 360,
								height: 28,
								borderRadius: 8,
								background: 'rgba(255,255,255,0.07)',
								color: 'rgba(245,245,247,0.72)',
								fontSize: 13,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								fontFamily: FONT,
								letterSpacing: '-0.005em',
							}}
						>
							{url}
						</div>
					</div>
				</div>
				<div style={{ position: 'relative', width: APP_W, height: APP_H, overflow: 'hidden', isolation: 'isolate' }}>{children}</div>
			</div>
		</Surface>
	)
}

/** A feature scene: stage, caption at the top, the real page in a window under it. */
export function FeatureShot({ caption, keys, url, children }: { caption: string; keys: string[]; url: string; children: ReactNode }) {
	return (
		<Stage>
			<Caption text={caption} keys={keys} />
			<BrowserWindow url={url}>{children}</BrowserWindow>
		</Stage>
	)
}
