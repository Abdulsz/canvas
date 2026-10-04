import { useEffect, useRef, useState } from 'react'
import { useValue, type Editor } from 'tldraw'
import { AGENT_NAME, type ReviewMode } from '../../../shared/protocol.ts'
import { acceptSuggestion, dismissSuggestion } from '../agent/executor.ts'
import {
	isSpeaking,
	micSupported,
	setMuted,
	speechRecognitionSupported,
	startBrowserRecognition,
	startConversation,
	stopSpeaking,
	unlockAudio,
	type ListenState,
	type Listener,
} from '../agent/speech.ts'
import type { AgentState, LogEntry, useAgent } from '../agent/useAgent.ts'
import type { Identity } from '../identity.ts'
import { CheckIcon, LinkIcon, MicIcon, SendIcon, SparkleIcon, SpeakerIcon, StopIcon } from './icons.tsx'

type Props = {
	roomId: string
	me: Identity
	editor: Editor | null
	state: AgentState
	actions: ReturnType<typeof useAgent>['actions']
}

const MODES: { id: ReviewMode; label: string; hint: string }[] = [
	{ id: 'on_request', label: 'On Request', hint: 'Grok reviews when you ask or tap Check my work.' },
	{ id: 'proactive', label: 'Proactive', hint: 'Grok takes a look whenever you pause drawing.' },
	{ id: 'exercise', label: 'Exercise', hint: 'Grok sets a task, then grades your drawing.' },
]

const SUGGESTED_PROMPTS = ['Explain a web architecture', 'Show two pointers on an array', 'Give me an exercise']

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

function Avatar({ name, color, ring }: { name: string; color: string; ring?: boolean }) {
	return (
		<span
			className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${ring ? 'ring-2 ring-[var(--card)]' : ''}`}
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
		<div className={`fade-up flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
			{showName && !mine && <span className="mb-0.5 ml-3 text-[11px] font-medium text-[var(--label-3)]">{entry.from}</span>}
			<div
				className={`max-w-[86%] whitespace-pre-wrap rounded-[18px] px-3.5 py-2 text-[14px] leading-[1.35] ${
					mine
						? 'rounded-br-[6px] bg-[var(--bubble-me)] text-[var(--on-accent)]'
						: agent
							? 'rounded-bl-[6px] bg-[var(--bubble-agent)] text-[var(--label)]'
							: 'rounded-bl-[6px] bg-[var(--bubble-other)] text-[var(--label)] shadow-[0_0_0_0.5px_var(--separator)]'
				}`}
			>
				{entry.text}
			</div>
		</div>
	)
}

export function AgentPanel({ roomId, me, editor, state, actions }: Props) {
	const [text, setText] = useState('')
	const [listenState, setListenState] = useState<ListenState | null>(null)
	const [level, setLevel] = useState(0)
	const [muted, setMutedState] = useState(false)
	const [copied, setCopied] = useState(false)
	const [micError, setMicError] = useState<string | null>(null)
	const recRef = useRef<Listener | null>(null)
	const listening = listenState !== null
	const logRef = useRef<HTMLDivElement>(null)
	const suggestions = useSuggestions(editor)

	useEffect(() => {
		logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
	}, [state.log.length, state.busy])

	useEffect(() => () => recRef.current?.stop(), [])

	const stopListening = () => {
		recRef.current?.stop()
		recRef.current = null
		setListenState(null)
		setLevel(0)
	}

	// Hands-free conversation: the mic stays open; each utterance is transcribed and sent.
	const toggleMic = async () => {
		if (listening) return stopListening()
		unlockAudio()
		const handlers = {
			onState: setListenState,
			onLevel: setLevel,
			// Barge-in: talking over the agent cuts its voice off right away; the
			// transcript then interrupts the agent's turn on the server.
			onSpeechStart: () => isSpeaking() && stopSpeaking(),
			onFinal: (t: string) => t && actions.say(t),
			onError: (m: string) => setMicError(m),
			onEnd: () => {
				recRef.current = null
				setListenState(null)
			},
		}
		setMicError(null)
		try {
			recRef.current = state.voice === 'grok' && micSupported() ? await startConversation(handlers) : startBrowserRecognition(handlers)
			if (!recRef.current) setMicError('Voice input is not supported in this browser.')
		} catch (err) {
			setMicError((err as Error).name === 'NotAllowedError' ? 'Microphone access was denied.' : (err as Error).message)
			setListenState(null)
		}
	}

	const submit = (e: React.FormEvent) => {
		e.preventDefault()
		if (!text.trim()) return
		actions.say(text)
		setText('')
	}

	const orbState = !state.connected ? 'offline' : state.speaking ? 'speaking' : state.busy ? 'thinking' : 'idle'
	const status = !state.connected ? 'Connecting…' : state.activity || (state.speaking ? 'Speaking…' : state.busy ? 'Working…' : 'Ready')
	const others = state.participants.filter((p) => p.userId !== me.userId)
	const modeIndex = MODES.findIndex((m) => m.id === state.mode)

	return (
		<aside className="relative flex h-[55%] w-full shrink-0 flex-col overflow-hidden rounded-[22px] bg-[var(--material-thick)] text-[var(--label)] shadow-[var(--shadow-panel)] md:h-full md:w-[372px]">
			{/* Header */}
			<header className="hairline-b flex items-center gap-3 px-4 pb-2.5 pt-3 md:pb-3 md:pt-4">
				<Orb state={orbState} />
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5 text-[17px] font-semibold leading-tight tracking-[-0.022em]">
						<span className="truncate whitespace-nowrap">
							<span className="sm:hidden">Grok</span>
							<span className="hidden sm:inline">{AGENT_NAME}</span>
						</span>
						{state.provider === 'mock' && (
							<span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--orange)_16%,transparent)] px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.04em] text-[color-mix(in_srgb,var(--orange)_75%,var(--label))] md:hidden">
								Demo
							</span>
						)}
					</div>
					<div className="truncate text-[13px] text-[var(--label-2)]" data-testid="agent-activity" aria-live="polite">
						{status}
					</div>
				</div>
				<button
					className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--label-2)] transition hover:bg-[var(--fill)] active:scale-95"
					onClick={() => {
						setMuted(!muted)
						setMutedState(!muted)
					}}
					title={muted ? 'Unmute Grok' : 'Mute Grok'}
					aria-label={muted ? 'Unmute Grok' : 'Mute Grok'}
					aria-pressed={muted}
				>
					<SpeakerIcon muted={muted} className="h-[18px] w-[18px]" />
				</button>
				<button
					className="flex h-8 items-center gap-1.5 rounded-full bg-[var(--fill)] px-3 text-[13px] font-medium text-[var(--accent)] transition hover:bg-[var(--accent-soft)] active:scale-95"
					onClick={() => {
						void navigator.clipboard?.writeText(location.href)
						setCopied(true)
						setTimeout(() => setCopied(false), 1600)
					}}
					title={`Copy link to room ${roomId}`}
				>
					{copied ? <CheckIcon className="h-3.5 w-3.5" /> : <LinkIcon className="h-3.5 w-3.5" />}
					{copied ? 'Copied' : 'Invite'}
				</button>
			</header>

			<div className="hairline-b space-y-2.5 px-4 py-3 md:space-y-3.5 md:py-3.5">
				{state.provider === 'mock' && (
					<div className="hidden items-start gap-2 rounded-xl bg-[color-mix(in_srgb,var(--orange)_12%,transparent)] px-3 py-2 text-[12px] leading-snug text-[color-mix(in_srgb,var(--orange)_70%,var(--label))] md:flex">
						<SparkleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
						<span>Demo mode — a scripted agent is answering. Add an XAI_API_KEY on the server to use Grok.</span>
					</div>
				)}

				{/* People in the room */}
				<div className="flex items-center gap-2.5" data-testid="participants">
					<div className="flex -space-x-1.5">
						<Avatar name={me.name} color={me.color} ring />
						{others.slice(0, 4).map((p) => (
							<Avatar key={p.userId} name={p.name} color={p.color} ring />
						))}
					</div>
					<div className="min-w-0 truncate text-[13px] text-[var(--label-2)]">
						<span className="font-medium text-[var(--label)]">{me.name}</span>
						{others.length > 0 && (
							<>
								{' with '}
								{others.map((p, i) => (
									<span key={p.userId}>
										{i > 0 && (i === others.length - 1 ? ' and ' : ', ')}
										<span>{p.name}</span>
									</span>
								))}
							</>
						)}
						{others.length === 0 && <span className="hidden sm:inline"> · invite others to draw together</span>}
					</div>
				</div>

				{/* Review mode: Apple-style segmented control */}
				<div>
					<div className="relative grid grid-cols-3 rounded-[10px] bg-[var(--fill)] p-[2px]" role="radiogroup" aria-label="Review mode">
						<div
							className="absolute bottom-[2px] top-[2px] rounded-[8px] bg-[var(--card)] shadow-[var(--shadow-control)] transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
							style={{ width: 'calc((100% - 4px) / 3)', left: 2, transform: `translateX(${Math.max(0, modeIndex) * 100}%)` }}
							aria-hidden
						/>
						{MODES.map((m) => (
							<button
								key={m.id}
								role="radio"
								aria-checked={state.mode === m.id}
								className={`relative z-10 rounded-[8px] py-[5px] text-[13px] transition-colors ${
									state.mode === m.id ? 'font-semibold text-[var(--label)]' : 'font-medium text-[var(--label-2)] hover:text-[var(--label)]'
								}`}
								onClick={() => actions.setMode(m.id)}
							>
								{m.label}
							</button>
						))}
					</div>
					<p className="mt-1.5 hidden px-0.5 text-[12px] text-[var(--label-3)] md:block">{MODES[Math.max(0, modeIndex)].hint}</p>
				</div>

				<div className="flex gap-2">
					<button
						className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--accent)] text-[15px] font-semibold text-[var(--on-accent)] shadow-[0_1px_2px_rgba(0,0,0,0.12),0_4px_14px_rgba(0,0,0,0.18)] transition hover:bg-[var(--accent-hover)] active:scale-[0.98] disabled:opacity-40"
						onClick={actions.checkWork}
						disabled={!state.connected}
						title="Ask Grok to review your drawing (only the selected shapes, if any)"
					>
						<CheckIcon className="h-[17px] w-[17px]" />
						Check my work
					</button>
					{state.busy && (
						<button
							className="pop flex h-11 w-11 items-center justify-center rounded-full bg-[var(--fill)] text-[var(--label)] transition hover:bg-[var(--fill-2)] active:scale-95"
							onClick={actions.stop}
							title="Stop"
							aria-label="Stop"
						>
							<StopIcon className="h-4 w-4" />
						</button>
					)}
				</div>
			</div>

			{/* Suggestions awaiting a decision */}
			{suggestions.length > 0 && editor && (
				<div className="hairline-b space-y-2 px-4 py-3">
					<div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--label-3)]">Suggested corrections</div>
					{suggestions.map((s) => (
						<div key={s.id} className="pop rounded-2xl bg-[var(--card)] p-3 shadow-[var(--shadow-control)]">
							<div className="text-[13px] leading-snug text-[var(--label)]">{s.explanation || s.id}</div>
							<div className="mt-2.5 flex gap-2">
								<button
									className="h-7 rounded-full bg-[var(--accent)] px-3.5 text-[13px] font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-hover)] active:scale-95"
									onClick={() => acceptSuggestion(editor, s.id, { kind: 'user', id: me.userId, name: me.name })}
								>
									Accept
								</button>
								<button
									className="h-7 rounded-full bg-[var(--fill)] px-3.5 text-[13px] font-medium text-[var(--label)] transition hover:bg-[var(--fill-2)] active:scale-95"
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
					className="pop mx-4 mt-3 flex items-center justify-center gap-2 rounded-full bg-[var(--accent)] py-2 text-[13px] font-semibold text-[var(--on-accent)]"
					onClick={unlockAudio}
				>
					<SpeakerIcon className="h-4 w-4" /> Tap to hear Grok
				</button>
			)}

			{/* Conversation */}
			<div ref={logRef} className="scroll-soft min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-3" data-testid="agent-log">
				{state.log.length === 0 && (
					<div className="flex h-full flex-col items-center justify-center px-1 text-center md:px-4">
						<div className="hidden flex-col items-center md:flex">
							<Orb state={orbState} size={52} />
							<p className="mt-3 text-[15px] font-semibold">What shall we learn?</p>
							<p className="mt-1 text-[13px] leading-snug text-[var(--label-2)]">Ask a question, or draw on the board and tap Check my work.</p>
						</div>
						<div className="flex max-w-full gap-1.5 overflow-x-auto md:mt-4 md:flex-wrap md:justify-center">
							{SUGGESTED_PROMPTS.map((p) => (
								<button
									key={p}
									className="shrink-0 rounded-full bg-[var(--fill-2)] px-3 py-1.5 text-[13px] text-[var(--accent)] transition hover:bg-[var(--accent-soft)] active:scale-95 disabled:opacity-40"
									onClick={() => actions.say(p)}
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
					<div className="fade-up flex items-center gap-1 rounded-[18px] rounded-bl-[6px] bg-[var(--bubble-agent)] px-3.5 py-3 w-fit" aria-label="Grok is working">
						{[0, 1, 2].map((d) => (
							<span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--label-3)]" style={{ animationDelay: `${d * 140}ms` }} />
						))}
					</div>
				)}
				{listenState === 'transcribing' && <div className="fade-up text-right text-[13px] italic text-[var(--label-3)]">Transcribing…</div>}
				{micError && <div className="fade-up text-center text-[12px] text-[var(--red)]">{micError}</div>}
			</div>

			{/* Composer */}
			<form onSubmit={submit} className="hairline-t flex items-center gap-2 px-3 py-3">
				{(micSupported() || speechRecognitionSupported()) && (
					<button
						type="button"
						onClick={toggleMic}
						className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${
							listening ? 'bg-[var(--red)] text-white' : 'bg-[var(--fill)] text-[var(--label)] hover:bg-[var(--fill-2)]'
						}`}
						title={listening ? 'Stop listening' : 'Talk to Grok'}
						aria-label={listening ? 'Stop listening' : 'Talk to Grok'}
						aria-pressed={listening}
					>
						{listening && (
							<span
								className="absolute inset-0 rounded-full bg-[var(--red)] opacity-30 transition-transform duration-75"
								style={{ transform: `scale(${1 + level * 0.9})` }}
								data-testid="mic-level"
							/>
						)}
						<MicIcon className="relative h-[18px] w-[18px]" />
					</button>
				)}
				<div className="flex h-9 min-w-0 flex-1 items-center rounded-full bg-[var(--card)] pl-4 pr-1 shadow-[0_0_0_0.5px_var(--separator)] transition focus-within:shadow-[0_0_0_1px_var(--accent)]">
					<input
						className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--label)] outline-none focus-visible:outline-none placeholder:text-[var(--label-3)]"
						placeholder={
							listenState === 'hearing' ? 'Hearing you…' : listenState === 'transcribing' ? 'Transcribing…' : listening ? 'Listening — just talk' : 'Ask Professor Grok'
						}
						value={text}
						onChange={(e) => setText(e.target.value)}
						aria-label="Message Professor Grok"
					/>
					<button
						type="submit"
						disabled={!text.trim()}
						className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--on-accent)] transition enabled:active:scale-90 disabled:scale-75 disabled:opacity-0"
						aria-label="Send"
					>
						<SendIcon className="h-4 w-4" />
					</button>
				</div>
			</form>

			{state.pendingConfirm && (
				<div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/25 px-4 backdrop-blur-[2px]">
					<div className="material pop w-[290px] overflow-hidden rounded-[16px] shadow-[var(--shadow-panel)]" role="alertdialog" aria-label="Permission request">
						<div className="px-5 pb-4 pt-5 text-center">
							<div className="mx-auto w-fit">
								<Orb state="idle" size={30} />
							</div>
							<p className="mt-3 text-[17px] font-semibold tracking-[-0.02em]">Allow this change?</p>
							<p className="mt-1 text-[13px] leading-snug text-[var(--label-2)]">{state.pendingConfirm.message}</p>
						</div>
						<div className="hairline-t grid grid-cols-2">
							<button
								className="h-11 text-[17px] text-[var(--accent)] transition hover:bg-[var(--fill-2)] active:bg-[var(--fill)]"
								onClick={() => state.pendingConfirm!.resolve(false)}
							>
								Don't Allow
							</button>
							<button
								className="h-11 text-[17px] font-semibold text-[var(--accent)] shadow-[inset_0.5px_0_0_var(--separator)] transition hover:bg-[var(--fill-2)] active:bg-[var(--fill)]"
								onClick={() => state.pendingConfirm!.resolve(true)}
							>
								Allow
							</button>
						</div>
					</div>
				</div>
			)}
		</aside>
	)
}
