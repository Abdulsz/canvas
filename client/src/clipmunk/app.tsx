// The real Grok Design app for the launch video, without a server: the real
// <Tldraw> editor on a local in-memory store (no sync) with the app's custom
// shapes, the real CanvasExecutor building screens from the mock agent's specs,
// and the real shell (TopBar, LayersPanel, EmptyCanvas, VoiceDock, AgentPanel,
// DesignPanel, CodeModal). The agent connection is replaced by sample state
// that follows the scene clock. The layout wrappers mirror Board.tsx (which
// needs a live sync server), so the page reads exactly like the app.
// Development only: nothing in the app imports this.
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import { useSceneTime } from 'clipmunk'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, DEFAULT_THEME, Tldraw, type Editor, type TLComponents, type TLShapeId, type TLThemes } from 'tldraw'
import { registerAuthorship } from '../agent/authorship.ts'
import { CanvasExecutor } from '../agent/executor.ts'
import type { AgentState, LogEntry } from '../agent/useAgent.ts'
import type { Voice } from '../agent/useVoice.ts'
import { AgentPanel, Orb } from '../components/AgentPanel.tsx'
import { customShapeUtils } from '../design/shapes.ts'
import type { Identity } from '../identity.ts'
import { CodeModal } from '../shell/CodeModal.tsx'
import { DesignPanel } from '../shell/DesignPanel.tsx'
import { EmptyCanvas } from '../shell/EmptyCanvas.tsx'
import { LayersPanel } from '../shell/LayersPanel.tsx'
import { TopBar } from '../shell/TopBar.tsx'
import { VoiceDock } from '../shell/VoiceDock.tsx'

// Same canvas configuration as Board.tsx.
const assetUrls = getAssetUrlsByImport()
const SELECTION = '#0D99FF'
const themes: Partial<TLThemes> = {
	default: {
		...DEFAULT_THEME,
		colors: {
			light: { ...DEFAULT_THEME.colors.light, background: '#ebebed', selectionStroke: SELECTION, selectionFill: 'rgba(13, 153, 255, 0.14)' },
			dark: { ...DEFAULT_THEME.colors.dark, background: '#111113', selectionStroke: SELECTION, selectionFill: 'rgba(13, 153, 255, 0.2)' },
		},
	},
}
const components: TLComponents = { StylePanel: null, PageMenu: null, QuickActions: null, ActionsMenu: null }

export const ME: Identity = { userId: 'video-ava', name: 'Ava Kim', color: '#1971c2' }
const MAYA = { userId: 'video-maya', name: 'Maya Chen', color: '#c2255c' }

export type Ctx = { editor: Editor; exec: CanvasExecutor; t: number }
/** What the agent connection would report at time t (sample state). */
export type AgentShot = { log?: Omit<LogEntry, 'id'>[]; busy?: boolean; speaking?: boolean; activity?: string; listen?: 'listening' | 'hearing' | null }

const noop = () => {}

function fakeVoice(state: AgentState, listen: AgentShot['listen']): Voice {
	const orbState = state.speaking ? 'speaking' : state.busy ? 'thinking' : 'idle'
	const status = state.activity || (state.speaking ? 'Speaking…' : state.busy ? 'Working…' : 'Ready')
	return {
		supported: true,
		listenState: listen ?? null,
		listening: !!listen,
		level: listen === 'hearing' ? 0.45 : 0.05,
		error: null,
		live: { active: false, state: null, level: 0, error: null, start: noop, stop: noop, sendText: noop, checkWork: noop },
		liveMode: false,
		setLiveMode: noop,
		toggleMic: noop,
		sendText: noop,
		critique: noop,
		orbState,
		status,
	} as unknown as Voice
}

const fakeActions = { say: noop, checkWork: noop, setMode: noop, stop: noop, log: noop, agentCursor: noop, confirm: async () => true } as any

type Props = {
	/** Builds the canvas once the editor exists (runs again only on remount). */
	setup?: (c: Omit<Ctx, 't'>) => void
	/** Applies time-driven edits; called on every scene-clock change. */
	drive?: (c: Ctx) => void
	agent?: (t: number) => AgentShot
	/** Text in the agent's message field at time t (typed into the real input). */
	typing?: (t: number) => string
	tab?: 'design' | 'agent'
	/** Opens the real Copy code modal for this screen while it returns an id. */
	code?: (t: number) => string | null
}

export function GrokDesign({ setup, drive, agent, typing, tab = 'agent', code }: Props) {
	const t = useSceneTime()
	const [editor, setEditor] = useState<Editor | null>(null)
	const exec = useMemo(() => (editor ? new CanvasExecutor(editor, { asUser: true }) : null), [editor])
	const agentExec = useMemo(() => (editor ? new CanvasExecutor(editor) : null), [editor])
	const root = useRef<HTMLDivElement>(null)
	const canvas = useRef<HTMLDivElement>(null)

	const shot = agent?.(t) ?? {}
	const state: AgentState = {
		connected: true,
		mode: 'on_request',
		busy: !!shot.busy,
		speaking: !!shot.speaking,
		activity: shot.activity ?? '',
		provider: 'grok',
		voice: 'grok',
		realtime: false,
		audioBlocked: false,
		participants: [ME, MAYA],
		log: (shot.log ?? []).map((e, i) => ({ ...e, id: i + 1 })),
		agentCursor: null,
		pendingConfirm: null,
	}
	const voice = fakeVoice(state, shot.listen)

	// The canvas lives inside a 3D-transformed Surface, so tldraw's own
	// getBoundingClientRect measurement is scaled. Keep its viewport at the
	// element's real layout size so fitting and culling work as in the app.
	const syncViewport = (e: Editor) => {
		const el = canvas.current
		if (!el) return
		const vp = e.getViewportScreenBounds()
		if (vp.x !== 0 || vp.y !== 0 || vp.w !== el.offsetWidth || vp.h !== el.offsetHeight) e.updateViewportScreenBounds(new Box(0, 0, el.offsetWidth, el.offsetHeight))
	}

	useLayoutEffect(() => {
		if (!editor || !agentExec) return
		syncViewport(editor)
		drive?.({ editor, exec: agentExec, t })
	})

	// Typing into the real input: set its value as the browser would and let React's onChange run.
	const text = typing?.(t)
	useLayoutEffect(() => {
		if (text === undefined) return
		const input = root.current?.querySelector<HTMLInputElement>('[data-testid="agent-input"]')
		if (!input || input.value === text) return
		if (text) input.focus()
		else input.blur()
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
		input.dispatchEvent(new Event('input', { bubbles: true }))
	}, [text])

	const codeFor = (code?.(t) ?? null) as TLShapeId | null

	return (
		<div ref={root} className="flex h-full flex-col bg-[var(--bg)] text-[var(--label)]" style={{ width: '100%', height: '100%' }}>
			<TopBar roomId="coffee-app" me={ME} participants={state.participants} editor={editor} exec={exec} onOpenCode={noop} onToggleLayers={noop} layersOpen={false} />
			<div className="relative flex min-h-0 flex-1 flex-col gap-2 md:flex-row md:px-2 md:pb-2">
				<div className="hidden absolute bottom-0 left-0 top-0 z-[700] w-[min(300px,86vw)] pb-[max(8px,env(safe-area-inset-bottom))] pl-2 md:static md:z-auto md:flex md:w-[232px] md:shrink-0 md:p-0 md:[animation:none] lg:w-[248px]">
					<LayersPanel editor={editor} exec={exec} />
				</div>
				<div ref={canvas} className="relative mx-2 min-h-0 min-w-0 flex-1 overflow-hidden rounded-[16px] shadow-[var(--shadow-panel)] md:mx-0" data-testid="canvas">
					<Tldraw
						shapeUtils={customShapeUtils}
						assetUrls={assetUrls}
						themes={themes}
						licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
						components={components}
						onMount={(e) => {
							e.user.updateUserPreferences({ colorScheme: 'system' })
							const off = registerAuthorship(e, ME)
							syncViewport(e)
							setup?.({ editor: e, exec: new CanvasExecutor(e) })
							setEditor(e)
							return off
						}}
					/>
					<EmptyCanvas editor={editor} exec={exec} voice={voice} connected busy={state.busy} />
					<VoiceDock state={state} voice={voice} build={null} onOpenAgent={noop} onStop={noop} />
				</div>
				<aside className="flex w-full shrink-0 flex-col overflow-hidden rounded-t-[20px] bg-[var(--material-thick)] text-[var(--label)] shadow-[var(--shadow-panel)] backdrop-blur-[24px] md:h-full md:w-[300px] md:rounded-[16px] lg:w-[320px]" data-testid="side-panel">
					<div className="hairline-b flex h-[52px] shrink-0 items-center gap-1 px-2 md:h-11" role="tablist" aria-label="Panels">
						{(['design', 'agent'] as const).map((k) => (
							<button
								key={k}
								role="tab"
								aria-selected={tab === k}
								className={`tap relative flex h-11 items-center gap-1.5 rounded-[10px] px-3.5 text-[14px] md:h-8 md:rounded-[8px] md:px-3 md:text-[13px] ${
									tab === k ? 'bg-[var(--fill)] font-semibold text-[var(--label)]' : 'font-medium text-[var(--label-2)]'
								}`}
							>
								{k === 'agent' && <Orb state={voice.orbState} size={14} />}
								{k === 'design' ? 'Design' : 'Agent'}
							</button>
						))}
						{tab === 'design' && (
							<span className="ml-auto flex h-8 min-w-0 max-w-[55%] items-center gap-1.5 truncate rounded-[8px] px-2.5 text-[12px] text-[var(--label-2)]">
								<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--green)]" />
								<span className="truncate">{voice.status}</span>
							</span>
						)}
					</div>
					<div className={`${tab === 'design' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`} role="tabpanel" aria-label="Design">
						<DesignPanel editor={editor} exec={exec} onOpenCode={noop} />
					</div>
					<div className={`${tab === 'agent' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`} role="tabpanel" aria-label="Agent">
						<AgentPanel me={ME} editor={editor} state={state} actions={fakeActions} voice={voice} />
					</div>
				</aside>
			</div>
			{codeFor && editor && editor.getShape(codeFor) && <CodeModal editor={editor} id={codeFor} onClose={noop} />}
		</div>
	)
}

