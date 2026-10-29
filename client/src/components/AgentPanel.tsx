import { useEffect, useRef, useState } from 'react'
import { useValue, type Editor } from 'tldraw'
import { AGENT_NAME, type ReviewMode } from '../../../shared/protocol.ts'
import { acceptSuggestion, dismissSuggestion } from '../agent/executor.ts'
import { setMuted, unlockAudio } from '../agent/speech.ts'
import type { AgentState, LogEntry, useAgent } from '../agent/useAgent.ts'
import type { Voice } from '../agent/useVoice.ts'
import type { Identity } from '../identity.ts'
import { MicIcon, SendIcon, SparkleIcon, SpeakerIcon, StopIcon } from './icons.tsx'

type Props = {
	me: Identity
	editor: Editor | null
	state: AgentState
	actions: ReturnType<typeof useAgent>['actions']
	voice: Voice
}

const MODES: { id: ReviewMode; label: string; hint: string }[] = [
	{ id: 'on_request', label: 'On request', hint: 'Critiques only when you ask or tap Critique.' },
	{ id: 'proactive', label: 'Proactive', hint: 'Chimes in with ideas when you pause editing.' },
	{ id: 'guided', label: 'Guided', hint: 'Leads, one design decision at a time.' },
]

export const SUGGESTED_PROMPTS = ['Design a login screen', 'Build a dashboard', 'Make a landing page', 'Switch to dark mode']

export function Orb({ state, size = 36 }: { state: 'idle' | 'thinking' | 'speaking' | 'offline'; size?: number }) {
	return (
		<div className="relative shrink-0" style={{ width: size, height: size }}>
			<div className="orb absolute inset-0 rounded-full" data-state={state} />
			<div className="absolute inset-[2px] rounded-full bg-white/25 backdrop-blur-[2px]" />
			<div className="absolute inset-0 rounded-full shadow-[inset_0_1px_1px_rgba(255,255,255,0.6),inset_0_-2px_6px_rgba(0,0,0,0.15)]" />
		</div>
	)
}

const initials = (name: string) =>
	name
		.split(/\s+/)
		.map((w) => w[0])
		.join('')
		.slice(0, 2)
		.toUpperCase()

export function Avatar({ name, color, ring }: { name: string; color: string; ring?: boolean }) {
	return (
		<span
			className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${ring ? 'ring-2 ring-[var(--card)]' : ''}`}
			style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${color} 75%, white), ${color})` }}
			aria-hidden
		>
			{initials(name)}
		</span>
	)
}

function useSuggestions(editor: Editor | null) {
	return useValue(
		'suggestions',
		() => {
			if (!editor) return []
			const byId = new Map<string, string>()
			for (const s of editor.getCurrentPageShapes()) {
				const sug = s.meta?.suggestion as { id: string; explanation: string } | undefined
				if (sug && !byId.has(sug.id)) byId.set(sug.id, sug.explanation)
			}
			return [...byId].map(([id, explanation]) => ({ id, explanation }))
		},
		[editor]
	)
}

function Bubble({ entry, mine, showName }: { entry: LogEntry; mine: boolean; showName: boolean }) {
	if (entry.kind === 'error') {
		return (
			<div className="fade-up mx-auto max-w-[90%] rounded-xl bg-[color-mix(in_srgb,var(--red)_12%,transparent)] px-3 py-1.5 text-center text-[12px] text-[var(--red)]">
				{entry.text}
			</div>
		)
	}
	const agent = entry.kind === 'agent'
	return (
		<div className={`fade-up flex flex-col ${mine ? 'items-end' : 'items-start'} ${showName && mine ? 'mt-3' : ''}`}>
			{showName && !mine && (
				<span className="mb-1 ml-1 mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--label-2)]">
					{agent ? <Orb state="idle" size={16} /> : null}
					{entry.from}
				</span>
			)}
			<div
				className={`max-w-[86%] whitespace-pre-wrap rounded-[16px] px-3.5 py-2 text-[14px] leading-[1.4] ${
					mine
						? 'rounded-br-[6px] bg-[var(--bubble-me)] text-[var(--on-accent)]'
						: agent
							? 'rounded-tl-[6px] bg-[var(--bubble-agent)] text-[var(--label)]'
							: 'rounded-bl-[6px] bg-[var(--bubble-other)] text-[var(--label)] shadow-[0_0_0_0.5px_var(--separator)]'
				}`}
			>
				{entry.text}
			</div>
		</div>
	)
}

export function AgentPanel({ me, editor, state, actions, voice }: Props) {
	const [text, setText] = useState('')
	const [muted, setMutedState] = useState(false)
	const logRef = useRef<HTMLDivElement>(null)
	const suggestions = useSuggestions(editor)
	const { live, listenState, listening, orbState, status } = voice

	useEffect(() => {
		logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
	}, [state.log.length, state.busy])

	const submit = (e: React.FormEvent) => {
		e.preventDefault()
		if (!text.trim()) return
		voice.sendText(text)
		setText('')
	}

	const modeIndex = MODES.findIndex((m) => m.id === state.mode)

	return (
		<div className="relative flex min-h-0 flex-1 flex-col text-[var(--label)]">
			{/* Header */}
			{/* Phones: one slim row (status, badge, mute); the Agent tab already shows the orb and name. */}
			<header className="hairline-b flex items-center gap-3 px-4 py-1 md:py-2.5">
				<span className="hidden md:block">
					<Orb state={orbState} size={30} />
				</span>
				<div className="flex min-w-0 flex-1 items-center gap-2 md:block">
					<div className="flex items-center gap-1.5 text-[14px] font-semibold leading-tight tracking-[-0.01em] max-md:order-2">
						<span className="truncate whitespace-nowrap max-md:hidden">{AGENT_NAME}</span>
						{state.provider === 'mock' && (
							<span
								className="shrink-0 rounded-full bg-[var(--demo-bg)] px-2 py-px text-[12px] font-semibold text-[var(--demo-fg)]"
								title="A scripted agent is answering. Add an XAI_API_KEY on the server to use Grok."
							>
								Demo
							</span>
						)}
					</div>
					<div className="min-w-0 truncate text-[12px] text-[var(--label-2)] max-md:order-1" data-testid="agent-activity" aria-live="polite">
						{status}
					</div>
				</div>
				<button
					className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--label-2)] transition-[background-color,transform] duration-150 hover:bg-[var(--fill)] active:scale-95 active:bg-[var(--press)] md:-mr-1 md:h-8 md:w-8"
					onClick={() => {
						setMuted(!muted)
						setMutedState(!muted)
					}}
					title={muted ? `Unmute ${AGENT_NAME}` : `Mute ${AGENT_NAME}`}
					aria-label={muted ? `Unmute ${AGENT_NAME}` : `Mute ${AGENT_NAME}`}
					aria-pressed={muted}
				>
					<SpeakerIcon muted={muted} className="h-[18px] w-[18px]" />
				</button>
			</header>

			<div className="hairline-b flex flex-col gap-2.5 px-4 py-3 max-md:flex-row max-md:items-center max-md:gap-2 max-md:py-2.5">
				{/* Review mode: segmented control */}
				<div className="min-w-0 max-md:flex-1">
					<div className="relative grid grid-cols-3 rounded-[9px] bg-[var(--fill)] p-[2px]" role="radiogroup" aria-label="Agent mode">
						<div
							className="absolute bottom-[2px] top-[2px] rounded-[7px] bg-[var(--card)] shadow-[var(--shadow-control)] transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
							style={{ width: 'calc((100% - 4px) / 3)', left: 2, transform: `translateX(${Math.max(0, modeIndex) * 100}%)` }}
							aria-hidden
						/>
						{MODES.map((m) => (
							<button
								key={m.id}
								role="radio"
								aria-checked={state.mode === m.id}
								className={`tap relative z-10 h-11 rounded-[7px] text-[13px] transition-[color,transform] duration-150 active:scale-[0.96] md:h-7 md:text-[12px] ${
									state.mode === m.id ? 'font-semibold text-[var(--label)]' : 'font-medium text-[var(--label-2)] hover:text-[var(--label)]'
								}`}
								onClick={() => actions.setMode(m.id)}
							>
								{m.label}
							</button>
						))}
					</div>
					<p className="mt-1.5 hidden px-0.5 text-[12px] leading-snug text-[var(--label-3)] md:block">{MODES[Math.max(0, modeIndex)].hint}</p>
				</div>

				<div className="flex gap-2 max-md:shrink-0">
					<button
						className="tap flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--accent)] text-[14px] font-semibold max-md:px-4 md:h-9 text-[var(--on-accent)] shadow-[0_1px_2px_rgba(0,0,0,0.12),0_4px_14px_rgba(0,0,0,0.14)] transition-[background-color,transform] duration-150 hover:bg-[var(--accent-hover)] active:scale-[0.98] disabled:opacity-40"
						onClick={voice.critique}
						disabled={!state.connected}
						title={`Ask ${AGENT_NAME} for a design critique (only the selected nodes, if any)`}
					>
						<SparkleIcon className="h-[15px] w-[15px]" />
						Critique
					</button>
					{state.busy && (
						<button
							className="tap pop flex h-11 w-11 items-center justify-center rounded-full bg-[var(--fill)] md:h-9 md:w-9 text-[var(--label)] transition-[background-color,transform] duration-150 hover:bg-[var(--fill-strong)] active:scale-95"
							onClick={actions.stop}
							title="Stop"
							aria-label="Stop"
						>
							<StopIcon className="h-4 w-4" />
						</button>
					)}
				</div>
				{state.realtime && (
					<label className="flex cursor-pointer items-center justify-between gap-3 px-0.5">
						<span className="min-w-0">
							<span className="block text-[13px] font-medium text-[var(--label)]">
								Live voice <span className="ml-1 rounded-full bg-[var(--fill)] px-1.5 py-px text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--label-2)]">Beta</span>
							</span>
							<span className="block text-[12px] text-[var(--label-2)]">Speech-to-speech: faster replies, just you and {AGENT_NAME}</span>
						</span>
						<button
							type="button"
							role="switch"
							aria-checked={voice.liveMode}
							aria-label="Live voice"
							onClick={() => voice.setLiveMode(!voice.liveMode)}
							className={`tap relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-150 ${voice.liveMode ? 'bg-[var(--green)]' : 'bg-[var(--fill)]'}`}
						>
							<span
								className={`absolute left-0 top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 ${voice.liveMode ? 'translate-x-[20px]' : 'translate-x-[2px]'}`}
							/>
						</button>
					</label>
				)}
			</div>

			{/* Suggestions awaiting a decision */}
			{suggestions.length > 0 && editor && (
				<div className="hairline-b space-y-2 px-4 py-3">
					<div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--label-3)]">Suggestions</div>
					{suggestions.map((s) => (
						<div key={s.id} className="pop rounded-2xl bg-[var(--card)] p-3 shadow-[var(--shadow-control)]">
							<div className="text-[13px] leading-snug text-[var(--label)]">{s.explanation || s.id}</div>
							<div className="mt-2.5 flex gap-2">
								<button
									className="tap h-11 rounded-full bg-[var(--accent)] px-4 md:h-8 md:px-3.5 text-[13px] font-semibold text-[var(--on-accent)] transition-[background-color,transform] duration-150 hover:bg-[var(--accent-hover)] active:scale-95"
									onClick={() => acceptSuggestion(editor, s.id, { kind: 'user', id: me.userId, name: me.name })}
								>
									Accept
								</button>
								<button
									className="tap h-11 rounded-full bg-[var(--fill)] px-4 md:h-8 md:px-3.5 text-[13px] font-medium text-[var(--label)] transition-[background-color,transform] duration-150 hover:bg-[var(--fill-strong)] active:scale-95"
									onClick={() => dismissSuggestion(editor, s.id)}
								>
									Dismiss
								</button>
							</div>
						</div>
					))}
				</div>
			)}

			{state.audioBlocked && !muted && (
				<button
					className="pop mx-4 mt-3 flex min-h-10 items-center justify-center gap-2 rounded-full bg-[var(--accent)] py-2 text-[13px] font-semibold text-[var(--on-accent)] transition-transform duration-150 active:scale-[0.98]"
					onClick={unlockAudio}
				>
					<SpeakerIcon className="h-4 w-4" /> Tap to hear {AGENT_NAME}
				</button>
			)}

			{/* Conversation */}
			<div ref={logRef} className="scroll-soft min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-3" data-testid="agent-log">
				{state.log.length === 0 && (
					<div className="flex min-h-full flex-col items-center justify-center px-2 py-2 text-center">
						<p className="text-[14px] font-semibold tracking-[-0.01em]">What are we designing?</p>
						<p className="mt-1 max-w-[240px] text-[13px] leading-snug text-[var(--label-2)]">Describe a screen out loud or type it. Ask for edits the same way.</p>
						{/* Phones show the same starts on the canvas right above. */}
						<div className="mt-4 flex max-w-full flex-wrap justify-center gap-1.5 max-md:hidden">
							{SUGGESTED_PROMPTS.map((p) => (
								<button
									key={p}
									className="tap shrink-0 rounded-full bg-[var(--fill-2)] px-3 py-1.5 text-[13px] text-[var(--accent)] shadow-[0_0_0_0.5px_var(--separator)] transition-[background-color,transform] duration-150 hover:bg-[var(--accent-soft)] active:scale-95 disabled:opacity-40"
									onClick={() => voice.sendText(p)}
									disabled={!state.connected}
								>
									{p}
								</button>
							))}
						</div>
					</div>
				)}
				{state.log.map((e, i) => {
					const prev = state.log[i - 1]
					return <Bubble key={e.id} entry={e} mine={e.kind === 'user' && e.from === me.name} showName={!prev || prev.from !== e.from} />
				})}
				{state.busy && !state.speaking && (
					<div className="fade-up flex w-fit items-center gap-2 rounded-[16px] rounded-tl-[6px] bg-[var(--bubble-agent)] px-3.5 py-2" aria-label={`${AGENT_NAME} is working`}>
						<span className="voice-meter flex h-4 items-center gap-[3px]" data-phase="thinking" aria-hidden>
							{[0, 1, 2].map((d) => (
								<span key={d} className="voice-bar block w-[3px] rounded-full" style={{ animationDelay: `${d * 140}ms` }} />
							))}
						</span>
						<span className="shimmer-text text-[13px]">{status}</span>
					</div>
				)}
				{listenState === 'transcribing' && <div className="fade-up text-right text-[13px] italic text-[var(--label-2)]">Transcribing…</div>}
				{voice.error && <div className="fade-up text-center text-[12px] text-[var(--red)]">{voice.error}</div>}
			</div>

			{/* Composer */}
			<form onSubmit={submit} className="hairline-t flex items-center gap-2 px-3 py-2.5">
				{voice.supported && (
					<button
						type="button"
						onClick={voice.toggleMic}
						className={`tap relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-[background-color,transform] duration-150 active:scale-95 md:h-9 md:w-9 ${
							listening ? 'bg-[var(--red)] text-white' : 'bg-[var(--fill)] text-[var(--label)] hover:bg-[var(--fill-strong)]'
						}`}
						title={listening ? 'Stop listening' : 'Talk to Grok'}
						aria-label={listening ? 'Stop listening' : 'Talk to Grok'}
						aria-pressed={listening}
					>
						{listening && (
							<span
								className="absolute inset-0 rounded-full bg-[var(--red)] opacity-30 transition-transform duration-75"
								style={{ transform: `scale(${1 + voice.level * 0.9})` }}
								data-testid="mic-level"
							/>
						)}
						<MicIcon className="relative h-[18px] w-[18px]" />
					</button>
				)}
				<div className="flex h-11 min-w-0 flex-1 items-center rounded-full bg-[var(--card)] pl-4 shadow-[0_0_0_0.5px_var(--separator)] transition-shadow duration-150 focus-within:shadow-[0_0_0_1.5px_var(--focus)] md:h-9 md:pl-3.5 md:pr-0.5">
					<input
						className="h-full min-w-0 flex-1 bg-transparent text-[16px] md:text-[14px] text-[var(--label)] outline-none focus-visible:outline-none placeholder:text-[var(--label-3)]"
						placeholder={
							live.active
								? 'Live — just talk, or type'
								: listenState === 'hearing'
									? 'Hearing you…'
									: listenState === 'transcribing'
										? 'Transcribing…'
										: listening
											? 'Listening — just talk'
											: 'Describe a screen or an edit…'
						}
						value={text}
						onChange={(e) => setText(e.target.value)}
						aria-label={`Message ${AGENT_NAME}`}
						data-testid="agent-input"
					/>
					<button
						type="submit"
						disabled={!text.trim()}
						className="group/send flex h-11 w-11 shrink-0 items-center justify-center rounded-full md:h-8 md:w-8"
						aria-label="Send"
						title="Send (Enter)"
					>
						<span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--on-accent)] transition-[background-color,color,transform] duration-150 group-enabled/send:group-active/send:scale-90 group-disabled/send:bg-[var(--fill)] group-disabled/send:text-[var(--label-3)] md:h-7 md:w-7">
							<SendIcon className="h-4 w-4" />
						</span>
					</button>
				</div>
			</form>
		</div>
	)
}

/** Permission prompt for agent edits to user-made nodes (rendered at the app root so it shows on any tab). */
export function ConfirmDialog({ state }: { state: AgentState }) {
	if (!state.pendingConfirm) return null
	return (
		<div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/25 px-4 backdrop-blur-[2px]">
			<div className="material pop w-[290px] overflow-hidden rounded-[16px] shadow-[var(--shadow-panel)]" role="alertdialog" aria-label="Permission request">
				<div className="px-5 pb-4 pt-5 text-center">
					<div className="mx-auto w-fit">
						<Orb state="idle" size={30} />
					</div>
					<p className="mt-3 text-[15px] font-semibold tracking-[-0.01em]">Allow this change?</p>
					<p className="mt-1 text-[13px] leading-snug text-[var(--label-2)]">{state.pendingConfirm.message}</p>
				</div>
				<div className="hairline-t grid grid-cols-2">
					<button
						className="h-11 text-[14px] text-[var(--accent)] transition-colors duration-150 hover:bg-[var(--fill-2)] active:bg-[var(--press)]"
						onClick={() => state.pendingConfirm!.resolve(false)}
					>
						Don't Allow
					</button>
					<button
						className="h-11 text-[14px] font-semibold text-[var(--accent)] shadow-[inset_0.5px_0_0_var(--separator)] transition-colors duration-150 hover:bg-[var(--fill-2)] active:bg-[var(--press)]"
						onClick={() => state.pendingConfirm!.resolve(true)}
					>
						Allow
					</button>
				</div>
			</div>
		</div>
	)
}

