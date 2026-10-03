import { useEffect, useRef, useState } from 'react'
import { useValue, type Editor } from 'tldraw'
import { AGENT_COLOR, type ReviewMode } from '../../../shared/protocol.ts'
import { acceptSuggestion, dismissSuggestion } from '../agent/executor.ts'
import { setMuted, speechRecognitionSupported, startListening, stopSpeaking } from '../agent/speech.ts'
import type { AgentState, useAgent } from '../agent/useAgent.ts'
import type { Identity } from '../identity.ts'

type Props = {
	roomId: string
	me: Identity
	editor: Editor | null
	state: AgentState
	actions: ReturnType<typeof useAgent>['actions']
}

const MODES: { id: ReviewMode; label: string; hint: string }[] = [
	{ id: 'on_request', label: 'On request', hint: 'Grok reviews when you press Check my work or ask.' },
	{ id: 'proactive', label: 'Proactive', hint: 'Grok looks after you pause drawing.' },
	{ id: 'exercise', label: 'Exercise', hint: 'Grok sets a task, then grades it.' },
]

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

export function AgentPanel({ roomId, me, editor, state, actions }: Props) {
	const [text, setText] = useState('')
	const [listening, setListening] = useState(false)
	const [interim, setInterim] = useState('')
	const [muted, setMutedState] = useState(false)
	const [copied, setCopied] = useState(false)
	const recRef = useRef<{ stop(): void } | null>(null)
	const logRef = useRef<HTMLDivElement>(null)
	const suggestions = useSuggestions(editor)
	const busyRef = useRef(state.busy)
	busyRef.current = state.busy

	useEffect(() => {
		logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
	}, [state.log.length])

	useEffect(() => () => recRef.current?.stop(), [])

	const toggleMic = () => {
		if (listening) {
			recRef.current?.stop()
			recRef.current = null
			setListening(false)
			setInterim('')
			return
		}
		recRef.current = startListening({
			onSpeechStart: () => {
				// Barge-in: talking over the agent cuts its voice off.
				if (busyRef.current) stopSpeaking()
			},
			onInterim: setInterim,
			onFinal: (t) => {
				setInterim('')
				if (t) actions.say(t)
			},
			onError: (m) => {
				if (m !== 'no-speech') setListening(false)
			},
			onEnd: () => {
				recRef.current = null
				setListening(false)
			},
		})
		setListening(!!recRef.current)
	}

	const submit = (e: React.FormEvent) => {
		e.preventDefault()
		if (!text.trim()) return
		actions.say(text)
		setText('')
	}

	const others = state.participants.filter((p) => p.userId !== me.userId)

	return (
		<aside className="flex h-[42%] w-full shrink-0 flex-col border-t border-slate-200 bg-slate-50 text-sm md:h-full md:w-[340px] md:border-l md:border-t-0">
			{/* Header */}
			<div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
				<div className="relative flex h-8 w-8 items-center justify-center rounded-full text-white" style={{ background: AGENT_COLOR }}>
					G
					<span
						className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-slate-50 ${
							!state.connected ? 'bg-slate-400' : state.busy ? 'animate-pulse bg-amber-400' : 'bg-emerald-500'
						}`}
					/>
				</div>
				<div className="min-w-0 flex-1">
					<div className="font-semibold text-slate-900">Professor Grok</div>
					<div className="truncate text-xs text-slate-500" data-testid="agent-activity">
						{!state.connected ? 'Connecting…' : state.activity || (state.busy ? 'Working…' : 'Ready')}
					</div>
				</div>
				<button
					className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
					onClick={() => {
						void navigator.clipboard?.writeText(location.href)
						setCopied(true)
						setTimeout(() => setCopied(false), 1500)
					}}
					title={`Room ${roomId}`}
				>
					{copied ? 'Copied!' : 'Invite'}
				</button>
			</div>

			{state.provider === 'mock' && (
				<div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
					Demo mode: no XAI_API_KEY on the server, so a scripted agent is answering.
				</div>
			)}

			{/* Participants + mode */}
			<div className="space-y-3 border-b border-slate-200 px-4 py-3">
				<div className="flex flex-wrap items-center gap-1.5" data-testid="participants">
					<span className="rounded-full px-2 py-0.5 text-xs text-white" style={{ background: me.color }}>
						{me.name} (you)
					</span>
					{others.map((p) => (
						<span key={p.userId} className="rounded-full px-2 py-0.5 text-xs text-white" style={{ background: p.color }}>
							{p.name}
						</span>
					))}
				</div>
				<div>
					<div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-200 p-1" role="radiogroup" aria-label="Review mode">
						{MODES.map((m) => (
							<button
								key={m.id}
								role="radio"
								aria-checked={state.mode === m.id}
								className={`rounded-md px-2 py-1 text-xs ${state.mode === m.id ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600'}`}
								onClick={() => actions.setMode(m.id)}
							>
								{m.label}
							</button>
						))}
					</div>
					<p className="mt-1 text-xs text-slate-500">{MODES.find((m) => m.id === state.mode)?.hint}</p>
				</div>
				<div className="flex gap-2">
					<button
						className="flex-1 rounded-lg bg-violet-600 px-3 py-2 font-medium text-white hover:bg-violet-700 disabled:opacity-50"
						onClick={actions.checkWork}
						disabled={!state.connected}
						title="Ask Grok to review your drawing (only the selected shapes, if any)"
					>
						✅ Check my work
					</button>
					{state.busy && (
						<button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700 hover:bg-slate-100" onClick={actions.stop}>
							Stop
						</button>
					)}
				</div>
			</div>

			{/* Suggestions awaiting a decision */}
			{suggestions.length > 0 && editor && (
				<div className="space-y-2 border-b border-slate-200 px-4 py-3">
					<div className="text-xs font-medium uppercase tracking-wide text-slate-500">Suggested corrections</div>
					{suggestions.map((s) => (
						<div key={s.id} className="rounded-lg border border-violet-200 bg-white p-2">
							<div className="text-xs text-slate-700">{s.explanation || s.id}</div>
							<div className="mt-2 flex gap-2">
								<button
									className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
									onClick={() => acceptSuggestion(editor, s.id, { kind: 'user', id: me.userId, name: me.name })}
								>
									Accept
								</button>
								<button className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100" onClick={() => dismissSuggestion(editor, s.id)}>
									Dismiss
								</button>
							</div>
						</div>
					))}
				</div>
			)}

			{/* Conversation */}
			<div ref={logRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3" data-testid="agent-log">
				{state.log.length === 0 && (
					<p className="text-xs text-slate-500">
						Ask Grok to explain something ("explain a load balancer", "show two pointers on an array"), or draw on the board and press Check my work.
					</p>
				)}
				{state.log.map((e) => (
					<div
						key={e.id}
						className={`rounded-lg px-3 py-2 ${
							e.kind === 'agent' ? 'bg-violet-100 text-violet-950' : e.kind === 'error' ? 'bg-red-100 text-red-900' : 'bg-white text-slate-800'
						}`}
					>
						<div className="text-[11px] font-medium opacity-70">{e.from}</div>
						<div className="whitespace-pre-wrap">{e.text}</div>
					</div>
				))}
				{interim && <div className="italic text-slate-500">{interim}…</div>}
			</div>

			{/* Input */}
			<form onSubmit={submit} className="flex items-center gap-2 border-t border-slate-200 p-3">
				{speechRecognitionSupported() && (
					<button
						type="button"
						onClick={toggleMic}
						className={`rounded-lg px-3 py-2 ${listening ? 'animate-pulse bg-red-500 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}
						title={listening ? 'Stop listening' : 'Talk to Grok'}
						aria-pressed={listening}
					>
						🎤
					</button>
				)}
				<input
					className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-violet-500"
					placeholder="Ask Professor Grok…"
					value={text}
					onChange={(e) => setText(e.target.value)}
					aria-label="Message Professor Grok"
				/>
				<button
					type="button"
					className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-slate-700 hover:bg-slate-100"
					onClick={() => {
						setMuted(!muted)
						setMutedState(!muted)
					}}
					title={muted ? 'Unmute Grok' : 'Mute Grok'}
					aria-pressed={muted}
				>
					{muted ? '🔇' : '🔊'}
				</button>
			</form>

			{state.pendingConfirm && (
				<div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/30 px-4">
					<div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" role="alertdialog" aria-label="Permission request">
						<p className="text-slate-800">{state.pendingConfirm.message}</p>
						<div className="mt-4 flex justify-end gap-2">
							<button className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100" onClick={() => state.pendingConfirm!.resolve(false)}>
								Decline
							</button>
							<button className="rounded-lg bg-violet-600 px-3 py-1.5 text-white hover:bg-violet-700" onClick={() => state.pendingConfirm!.resolve(true)}>
								Allow
							</button>
						</div>
					</div>
				</div>
			)}
		</aside>
	)
}
