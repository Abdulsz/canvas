// The recruiter demo video's shared pieces: the recorded live Grok session
// (fixtures/demo-session.json) replayed on the scene clock through the real
// CanvasExecutor, the agent state that session implies at any moment, and the
// overlays around the real app (caption, meta row, subtitles, pointer).
// Development only (Clipmunk studio and export); nothing in the app imports it.
import { Surface, useSceneTime } from 'clipmunk'
import type { ReactNode } from 'react'
import { Box, type Editor } from 'tldraw'
import { CanvasExecutor } from '../agent/executor.ts'
import type { LogEntry } from '../agent/useAgent.ts'
import type { BuildProgress } from '../Board.tsx'
import { Orb } from '../components/AgentPanel.tsx'
import { isScreen, isUi } from '../design/tree.ts'
import type { Identity } from '../identity.ts'
import { GrokDesign, type AgentShot } from './app.tsx'
import session from './fixtures/demo-session.json'
import { ACCENT, APP_W, BrowserWindow, FONT, INK, INK_2, Stage, W, Words, progress } from './look.tsx'

// ------------------------------------------------------------------ layout

/** The demo shows the app at 1280 x 720, scaled 1.06 (1357 x 810), between the caption band and the subtitle band. */
export const DEMO_APP_H = 720
export const DEMO_WIN_TOP = 205
export const URL = 'grokdesign.app/r/coffee-app'
export const USER: Identity = session.user

// ------------------------------------------------------------------ the recorded session

type Call = { t: number; kind: 'call'; name: string; args: Record<string, any> }
type Say = { t: number; kind: 'say'; text: string; ephemeral: boolean; voiceStart: number; voiceEnd: number }
type Status = { t: number; kind: 'status'; busy: boolean; activity: string }
type Ev = Call | Say | Status
export type Turn = { request: string; latencyMs: Record<string, number | null>; events: Ev[] }
export const TURNS = session.turns as unknown as Turn[]
export const LOGIN = 0
export const BROWN = 1
export const MENU = 2
export const DARK = 3
export const CRITIQUE = 4

/** Calls that change the canvas, in order (reads and the camera are left to the scene). */
const SKIP = new Set(['get_canvas_state', 'get_canvas_image', 'get_recent_changes', 'get_participants', 'focus_view'])
const CALLS = TURNS.flatMap((turn, ti) => turn.events.filter((e): e is Call => e.kind === 'call' && !SKIP.has(e.name)).map((c) => ({ ti, ...c })))
const applied = new WeakMap<Editor, number>()

/** Applies every recorded call up to (turn, ms into it); replays from an empty canvas when time went backwards. */
export function replay(editor: Editor, exec: CanvasExecutor, turn: number, ms: number) {
	const target = CALLS.filter((c) => c.ti < turn || (c.ti === turn && c.t <= ms)).length
	let n = applied.get(editor) ?? 0
	if (target < n) {
		const ids = [...editor.getCurrentPageShapeIds()]
		if (ids.length) editor.deleteShapes(ids)
		n = 0
	}
	for (; n < target; n++) void exec.run(CALLS[n].name, CALLS[n].args)
	applied.set(editor, n)
}

/** The conversation as the app logs it: requests, then each agent line when it arrives. */
function logUpTo(turn: number, ms: number): Omit<LogEntry, 'id'>[] {
	const out: Omit<LogEntry, 'id'>[] = []
	TURNS.forEach((tr, ti) => {
		if (ti > turn || (ti === turn && ms < 0)) return
		out.push({ from: USER.name, kind: 'user', text: tr.request === 'Critique' ? 'Critique my design' : tr.request })
		for (const e of tr.events) if (e.kind === 'say' && !e.ephemeral && (ti < turn || e.t <= ms)) out.push({ from: 'Grok Design', kind: 'agent', text: e.text })
	})
	return out
}

/** The agent connection's state at ms into a turn (ms < 0: before it was sent, while the user talks). */
export function agentAt(turn: number, ms: number, opts: { hearing?: boolean } = {}): AgentShot {
	const tr = TURNS[turn]
	const log = logUpTo(turn, ms)
	if (ms < 0) return { log, listen: opts.hearing ? 'hearing' : 'listening' }
	let busy = false
	let activity = ''
	for (const e of tr.events) if (e.kind === 'status' && e.t <= ms) ((busy = e.busy), (activity = e.activity))
	const speaking = tr.events.some((e) => e.kind === 'say' && e.voiceStart <= ms && ms < e.voiceEnd)
	return { log, busy, activity: busy ? activity : '', speaking, listen: 'listening' }
}

/** The line being spoken (or just spoken) at ms. */
export function lineAt(turn: number, ms: number, linger = 900): Say | null {
	const says = TURNS[turn].events.filter((e): e is Say => e.kind === 'say' && e.voiceStart <= ms && ms < e.voiceEnd + linger)
	return says.at(-1) ?? null
}

/** The latest canvas call at ms, described in a few words. */
export function callAt(turn: number, ms: number): { t: number; text: string } | null {
	const c = TURNS[turn].events.filter((e): e is Call => e.kind === 'call' && e.t <= ms && e.name !== 'focus_view').at(-1)
	if (!c) return null
	const a = c.args
	const text =
		c.name === 'create_skeleton'
			? `create_skeleton · ${a.kind} placeholder`
			: c.name === 'create_screen'
				? `create_screen · ${a.name}`
				: c.name === 'add_nodes'
					? `add_nodes · ${a.nodes?.map((n: any) => n.id).join(', ')}`
					: c.name === 'update_node'
						? `update_node · ${a.id} · ${Object.entries(a).filter(([k]) => k !== 'id').map(([k, v]) => `${k} ${v}`).join(', ')}`
						: c.name === 'set_theme'
							? `set_theme · ${a.screenId} → ${a.mode}`
							: c.name === 'connect_screens'
								? `connect_screens · ${a.fromId} → ${a.toId}`
								: c.name === 'highlight_shapes'
									? `highlight_shapes · ${a.shapeIds.join(', ')}`
									: c.name === 'add_comment'
										? `add_comment · ${a.kind} on ${a.targetShapeId}`
										: c.name === 'get_canvas_state'
											? 'get_canvas_state · audit'
											: c.name
	return { t: c.t, text }
}

/** The voice dock's build progress, as Board.tsx derives it from the canvas. */
export function buildFor(turn: number, ms: number) {
	return (editor: Editor): BuildProgress | null => {
		if (!agentAt(turn, ms).busy) return null
		const shapes = editor.getCurrentPageShapes()
		const sk = shapes.find((s) => isScreen(s) && s.meta?.skeleton)
		if (sk && isUi(sk)) return { name: sk.props.name || 'screen', skeleton: true, sections: 0, layers: 0 }
		const made = TURNS[turn].events.filter((e): e is Call => e.kind === 'call' && e.name === 'create_screen' && e.t <= ms).at(-1)
		const screen = made && editor.getShape(`shape:${made.args.id}` as any)
		if (!screen || !isUi(screen)) return null
		return { name: screen.props.name, skeleton: false, sections: editor.getSortedChildIdsForParent(screen.id).length, layers: editor.getShapeAndDescendantIds([screen.id]).size - 1 }
	}
}

// ------------------------------------------------------------------ time

/** A turn shown with honest cuts: scene time to real ms since the request was sent. */
export type Clock = { send: number; cuts: { at: number; to: number }[] }
export function realMs(clock: Clock, t: number) {
	let r = t - clock.send
	for (const c of clock.cuts) if (r >= c.at) r += c.to - c.at
	return r
}
/** Scene time of a cut (for its marker). */
function cutScene(clock: Clock, i: number) {
	let skipped = 0
	for (let j = 0; j < i; j++) skipped += clock.cuts[j].to - clock.cuts[j].at
	return clock.send + clock.cuts[i].at - skipped
}

// ------------------------------------------------------------------ camera

const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
export type Shot = { t: number; ids?: string[]; z?: number; ax?: number; ay?: number; pad?: number }

function boundsOf(editor: Editor, ids?: string[]) {
	const shapes = !ids
		? editor.getCurrentPageShapes().filter(isScreen)
		: ids[0] === '*'
			? editor.getCurrentPageShapes()
			: ids.map((id) => editor.getShape(`shape:${id}` as any)).filter(Boolean)
	const bs = shapes.map((s: any) => editor.getShapePageBounds(s)).filter(Boolean) as Box[]
	return bs.length ? Box.Common(bs) : null
}

function target(editor: Editor, s: Shot) {
	const b = boundsOf(editor, s.ids)
	if (!b) return null
	const vp = editor.getViewportScreenBounds()
	const pad = s.pad ?? 40
	// The voice dock covers the bottom ~130px of the canvas; the screen labels sit ~24px above each screen.
	const z = s.z ?? Math.min((vp.w - pad * 2) / b.w, (vp.h - 48 - 136) / b.h)
	return { x: b.x + b.w * (s.ax ?? 0.5), y: b.y + b.h * (s.ay ?? 0.5), z }
}

/** Moves the tldraw camera between framings on the scene clock (eased), each a page point at the canvas centre above the dock. */
export function camera(editor: Editor, t: number, shots: Shot[]) {
	let i = shots.findIndex((s) => s.t > t)
	if (i === -1) i = shots.length
	const a = shots[Math.max(0, i - 1)]
	const b = shots[Math.min(shots.length - 1, i)]
	const ta = target(editor, a)
	const tb = target(editor, b) ?? ta
	if (!ta || !tb) return
	const p = a === b ? 1 : ease(Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))))
	const p0 = i === 0 ? 1 : p
	const cx = ta.x + (tb.x - ta.x) * p0
	const cy = ta.y + (tb.y - ta.y) * p0
	const z = ta.z + (tb.z - ta.z) * p0
	const vp = editor.getViewportScreenBounds()
	const sy = (vp.h - 136 + 24) / 2
	const next = { x: vp.w / 2 / z - cx, y: sy / z - cy, z }
	const cur = editor.getCamera()
	if (Math.abs(cur.x - next.x) > 0.01 || Math.abs(cur.y - next.y) > 0.01 || Math.abs(cur.z - next.z) > 0.0001) editor.setCamera(next)
}

// ------------------------------------------------------------------ overlays

const pill = { display: 'inline-flex', alignItems: 'center', gap: 10, height: 40, padding: '0 18px', borderRadius: 20, background: 'rgba(255,255,255,0.07)', outline: '1px solid rgba(255,255,255,0.1)', color: INK_2, fontSize: 20, fontWeight: 500, letterSpacing: '-0.005em', whiteSpace: 'nowrap' } as const

function Fade({ at, children, dur = 320 }: { at: number; children: ReactNode; dur?: number }) {
	const t = useSceneTime()
	const p = progress(t, at, dur)
	return <span style={{ opacity: p, transform: `translateY(${(1 - p) * 8}px)`, display: 'inline-flex' }}>{children}</span>
}

/** The caption band above the window. */
export function DemoCaption({ text, keys = [], start = 150 }: { text: string; keys?: string[]; start?: number }) {
	return (
		<Surface id="caption" style={{ position: 'absolute', left: 0, top: 24, width: W, height: 84, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
			<div style={{ fontSize: 54, fontWeight: 650, letterSpacing: '-0.035em', lineHeight: 1.05, textAlign: 'center' }}>
				<Words text={text} keys={keys} start={start} rise={22} />
			</div>
		</Surface>
	)
}

/** The meta row under the caption: real time since the request, the latest tool call, and a marker for each cut. */
export function MetaRow({ turn, clock, note }: { turn?: number; clock?: Clock; note?: string }) {
	const t = useSceneTime()
	const items: ReactNode[] = []
	if (turn !== undefined && clock) {
		const ms = realMs(clock, t)
		const status = agentAt(turn, ms)
		const done = TURNS[turn].events.filter((e): e is Status => e.kind === 'status' && !e.busy).at(-1)
		if (ms >= 0) {
			const finished = done && ms >= done.t
			items.push(
				<span key="clock" style={{ ...pill, color: INK, fontVariantNumeric: 'tabular-nums' }}>
					<span style={{ width: 8, height: 8, borderRadius: 4, background: finished ? '#30d158' : status.busy ? ACCENT : INK_2 }} />
					{finished ? `Turn done · ${(done!.t / 1000).toFixed(1)}s` : `${(ms / 1000).toFixed(1)}s since request`}
				</span>
			)
			const call = callAt(turn, ms)
			if (call)
				items.push(
					<Fade key={call.text} at={t - (ms - call.t)}>
						<span style={{ ...pill, fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontSize: 18, maxWidth: 820, overflow: 'hidden', textOverflow: 'ellipsis' }}>{call.text}</span>
					</Fade>
				)
			clock.cuts.forEach((c, i) => {
				const at = cutScene(clock, i)
				if (t >= at && t < at + 1800)
					items.push(
						<Fade key={`cut${i}`} at={at} dur={200}>
							<span style={{ ...pill, color: INK, background: `${ACCENT}38`, outline: `1px solid ${ACCENT}80` }}>⏩ {((c.to - c.at) / 1000).toFixed(1)}s skipped</span>
						</Fade>
					)
			})
		}
	}
	if (note) items.push(<Fade key="note" at={500}><span style={{ ...pill, background: 'transparent', outline: 'none', fontSize: 22 }}>{note}</span></Fade>)
	return (
		<Surface id="meta" style={{ position: 'absolute', left: 0, top: 118, width: W, height: 48, fontFamily: FONT }}>
			<div style={{ width: W, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>{items}</div>
		</Surface>
	)
}

/** Subtitles under the window: what the user says (while talking, until Grok answers), then Grok's spoken lines. */
export function Subtitles({ turn, clock, talkAt, talkMs }: { turn?: number; clock?: Clock; talkAt?: number; talkMs?: number }) {
	const t = useSceneTime()
	let body: ReactNode = null
	if (turn !== undefined && clock && talkAt !== undefined) {
		const ms = realMs(clock, t)
		const line = ms >= 0 ? lineAt(turn, ms) : null
		const req = TURNS[turn].request
		if (line) {
			const at = t - (ms - line.voiceStart)
			body = (
				<Fade key={line.text} at={at} dur={220}>
					<span style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
						<Orb state="speaking" size={30} />
						<span style={{ color: INK_2, fontSize: 20, fontWeight: 600, letterSpacing: '0.08em' }}>GROK</span>
						<span style={{ color: INK, fontSize: 30, fontWeight: 500, letterSpacing: '-0.015em' }}>{line.text}</span>
					</span>
				</Fade>
			)
		} else if (t >= talkAt && req !== 'Critique' && (ms < 0 || !TURNS[turn].events.some((e) => e.kind === 'say' && e.voiceStart <= ms))) {
			const words = req.split(' ').length
			body = (
				<span style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
					<span style={{ ...pill, height: 34, fontSize: 16, fontWeight: 650, letterSpacing: '0.08em', color: INK, background: `${ACCENT}40`, outline: `1px solid ${ACCENT}90` }}>YOU SAID</span>
					<span style={{ color: INK, fontSize: 30, fontWeight: 500, letterSpacing: '-0.015em' }}>
						“<Words text={req} start={talkAt} stagger={(talkMs ?? 2000) / words} dur={260} rise={10} />”
					</span>
				</span>
			)
		}
	}
	return (
		<Surface id="subtitle" style={{ position: 'absolute', left: 0, top: 998, width: W, height: 72, fontFamily: FONT }}>
			<div style={{ width: W, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{body}</div>
		</Surface>
	)
}

/** A plain arrow pointer over the app (window layout pixels), gliding between points and pressing on clicks. */
export function Pointer({ path, clicks = [] }: { path: { t: number; x: number; y: number }[]; clicks?: number[] }) {
	const t = useSceneTime()
	if (!path.length || t < path[0].t - 300) return null
	let i = path.findIndex((p) => p.t > t)
	if (i === -1) i = path.length
	const a = path[Math.max(0, i - 1)]
	const b = path[Math.min(path.length - 1, i)]
	const prev = path[Math.max(0, i - 2)]
	// Each point is reached at its time; the move starts 700ms before (or right after the previous point).
	const start = Math.max(a.t, b.t - 700)
	const p = a === b ? 1 : ease(Math.max(0, Math.min(1, (t - start) / (b.t - start))))
	void prev
	const x = a.x + (b.x - a.x) * p
	const y = a.y + (b.y - a.y) * p
	const press = clicks.some((c) => t >= c && t < c + 160)
	const ring = clicks.map((c) => progress(t, c, 450)).find((v) => v > 0 && v < 1)
	const opacity = progress(t, path[0].t - 300, 300)
	return (
		<div style={{ position: 'absolute', left: 0, top: 0, width: APP_W, height: DEMO_APP_H, pointerEvents: 'none', zIndex: 2000, opacity }}>
			{ring !== undefined && <span style={{ position: 'absolute', left: x - 18, top: y - 18, width: 36, height: 36, borderRadius: 18, border: `2px solid ${ACCENT}`, opacity: 1 - ring, transform: `scale(${0.6 + ring * 0.8})` }} />}
			<svg width="22" height="28" viewBox="0 0 22 28" style={{ position: 'absolute', left: x - 2, top: y - 2, transform: `scale(${press ? 0.88 : 1})`, transformOrigin: '2px 2px' }}>
				<path d="M2 2 L2 22 L7.5 17 L11 25.5 L14.5 24 L11 15.8 L18.5 15.8 Z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
			</svg>
		</div>
	)
}

/** A demo scene: stage, caption band, meta row, the real app in a window, subtitles. */
export function DemoShot({ caption, keys, captionStart, meta, subtitles, children }: { caption: string; keys?: string[]; captionStart?: number; meta?: ReactNode; subtitles?: ReactNode; children: ReactNode }) {
	return (
		<Stage>
			<DemoCaption text={caption} keys={keys} start={captionStart} />
			{meta ?? <MetaRow />}
			<BrowserWindow url={URL} appH={DEMO_APP_H} top={DEMO_WIN_TOP}>
				{children}
			</BrowserWindow>
			{subtitles ?? <Subtitles />}
		</Stage>
	)
}

/** One turn of the recorded conversation in the real shell: the user talks, the request goes out, the recorded calls replay. */
export function TurnShot({ turn, clock, talkAt, talkMs, caption, keys, shots, children, edited }: { turn: number; clock: Clock; talkAt: number; talkMs: number; caption: string; keys?: string[]; shots: Shot[]; children?: ReactNode; edited?: boolean }) {
	const t = useSceneTime()
	const ms = realMs(clock, t)
	return (
		<DemoShot caption={caption} keys={keys} meta={<MetaRow turn={turn} clock={clock} />} subtitles={<Subtitles turn={turn} clock={clock} talkAt={talkAt} talkMs={talkMs} />}>
			<GrokDesign
				tab="agent"
				me={USER}
				agent={() => agentAt(turn, ms, { hearing: t >= talkAt && t < talkAt + talkMs + 150 })}
				build={buildFor(turn, ms)}
				drive={({ editor, exec, t }) => {
					replay(editor, exec, turn, realMs(clock, t))
					if (edited) radiusEdit(editor, t, -1)
					camera(editor, t, shots)
				}}
			/>
			{children}
		</DemoShot>
	)
}

// ------------------------------------------------------------------ the user's own edit (pro tools)

export const BUTTON = 'shape:login_submit'
/** The radius set in the Design panel (the button is 12 by default). */
export const PILL = 26
const users = new WeakMap<Editor, CanvasExecutor>()
/** A user-side executor per editor (edits stamped as the user, as the Design panel's own are). */
function userExec(editor: Editor) {
	let u = users.get(editor)
	if (!u) users.set(editor, (u = new CanvasExecutor(editor, { asUser: true })))
	return u
}
/** After the recorded conversation: the user's own radius edit from `at` on (what the Design panel's field commits). */
export function radiusEdit(editor: Editor, t: number, at: number) {
	const shape = editor.getShape(BUTTON as any) as any
	if (!shape) return
	const want = t >= at ? PILL : 12
	if (shape.props.radius !== want) void userExec(editor).run('update_node', { id: 'login_submit', radius: want })
}
/** The four recorded requests, then the radius edit. */
export function handEdit(editor: Editor, exec: CanvasExecutor, t: number, at: number) {
	replay(editor, exec, DARK, 1e9)
	radiusEdit(editor, t, at)
}
