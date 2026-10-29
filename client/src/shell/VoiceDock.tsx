import { useEffect, useState } from 'react'
import { AGENT_NAME } from '../../../shared/protocol.ts'
import type { AgentState } from '../agent/useAgent.ts'
import type { Voice } from '../agent/useVoice.ts'
import { Orb } from '../components/AgentPanel.tsx'
import { MicIcon, StopIcon } from '../components/icons.tsx'
import type { BuildProgress } from '../Board.tsx'

/** What the dock is showing, from the most to the least urgent. */
export type DockPhase = 'speaking' | 'thinking' | 'hearing' | 'listening' | 'idle' | 'offline'

const PHASE_LABEL: Record<DockPhase, string> = {
	speaking: 'Speaking',
	thinking: 'Designing',
	hearing: 'Hearing you',
	listening: 'Listening',
	idle: AGENT_NAME,
	offline: 'Offline',
}

/**
 * Live audio meter. Listening: bars follow the mic level. Speaking: bars dance
 * on their own (the agent's voice). Thinking: a slow travelling wave.
 */
function Meter({ phase, level }: { phase: DockPhase; level: number }) {
	const bars = [0.55, 0.85, 1, 0.75, 0.5]
	const live = phase === 'listening' || phase === 'hearing'
	return (
		<div className="voice-meter flex h-5 shrink-0 items-center gap-[3px]" data-phase={phase} aria-hidden>
			{bars.map((w, i) => (
				<span
					key={i}
					className="voice-bar block w-[3px] rounded-full"
					style={{
						height: live ? `${Math.round(4 + Math.min(1, level * 2.4) * 16 * w)}px` : undefined,
						animationDelay: `${i * 110}ms`,
					}}
				/>
			))}
		</div>
	)
}

/**
 * Voice-first control floating over the canvas: the agent's live status (orb,
 * state, what it is saying or doing, an audio meter) and the mic, which drives
 * the same hands-free conversation as the Agent tab's mic.
 */
export function VoiceDock({ state, voice, build, onOpenAgent, onStop }: { state: AgentState; voice: Voice; build?: BuildProgress | null; onOpenAgent: () => void; onStop: () => void }) {
	const buildText = build
		? build.skeleton
			? `Laying out ${build.name}…`
			: `Building ${build.name} · ${build.sections} ${build.sections === 1 ? 'section' : 'sections'} · ${build.layers} layers`
		: null
	const lastAgent = [...state.log].reverse().find((e) => e.kind === 'agent')
	// Subtitles: the agent's latest line stays up while it speaks and a few seconds after.
	const [fresh, setFresh] = useState<number | null>(null)
	useEffect(() => {
		if (!lastAgent) return
		setFresh(lastAgent.id)
		const t = setTimeout(() => setFresh((f) => (f === lastAgent.id ? null : f)), Math.min(9000, 2500 + lastAgent.text.length * 45))
		return () => clearTimeout(t)
	}, [lastAgent?.id])
	const caption = voice.live.active
		? voice.status
		: lastAgent && (state.speaking || fresh === lastAgent.id)
			? lastAgent.text
			: state.busy
				? (buildText ?? voice.status)
				: voice.listenState === 'hearing'
					? 'Hearing you…'
					: voice.listenState === 'transcribing'
						? 'Transcribing…'
						: voice.listening
							? 'Listening — describe a screen or an edit'
							: !state.connected
								? 'Connecting…'
								: null
	const phase: DockPhase =
		voice.orbState === 'speaking'
			? 'speaking'
			: voice.orbState === 'thinking' || voice.listenState === 'transcribing'
				? 'thinking'
				: voice.listenState === 'hearing'
					? 'hearing'
					: voice.listening
						? 'listening'
						: voice.orbState === 'offline'
							? 'offline'
							: 'idle'
	const active = !!caption
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-[72px] z-[300] flex justify-center px-3" data-testid="voice-dock">
			{/* 16px above tldraw's tool row (56px from the canvas bottom). */}
			<div className="voice-dock pointer-events-auto relative flex max-w-[min(600px,100%)] items-center gap-2 rounded-full p-1.5 md:gap-2.5" data-phase={phase}>
				<button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-transform duration-150 active:scale-95" onClick={onOpenAgent} title={`Open the ${AGENT_NAME} conversation`} aria-label={`Open ${AGENT_NAME} conversation`}>
					<Orb state={voice.orbState} size={36} />
				</button>
				{active ? (
					<button className="fade-up flex min-h-11 min-w-0 max-w-[420px] flex-col items-start justify-center text-left" onClick={onOpenAgent}>
						<span className="flex min-w-0 max-w-full items-center gap-1.5 text-[12px]">
							<span className="voice-phase shrink-0 font-semibold uppercase tracking-[0.06em]">{build && phase === 'thinking' ? (build.skeleton ? 'Sketching' : 'Building') : PHASE_LABEL[phase]}</span>
							{/* While the agent talks, the build progress stays visible next to the phase. */}
							{build && caption !== buildText && (
								<span className="truncate font-medium text-[var(--label-2)]" data-testid="build-progress">
									· {build.skeleton ? `laying out ${build.name}` : `${build.name}: ${build.sections} ${build.sections === 1 ? 'section' : 'sections'}`}
								</span>
							)}
						</span>
						<span
							className={`line-clamp-2 text-[13px] leading-[1.35] text-[var(--label)] md:text-[14px] ${phase === 'thinking' ? 'shimmer-text' : ''}`}
							data-testid="voice-caption"
							data-build={caption === buildText || undefined}
							aria-live="polite"
							title={caption ?? undefined}
						>
							{caption}
						</span>
					</button>
				) : (
					<button className="flex min-h-11 min-w-0 flex-col items-start justify-center pr-1 text-left" onClick={voice.supported ? voice.toggleMic : onOpenAgent}>
						<span className="text-[14px] font-semibold leading-tight tracking-[-0.01em] text-[var(--label)]">Talk to design</span>
						<span className="hidden text-[12px] leading-tight text-[var(--label-2)] sm:block">Tap the mic and describe a screen</span>
					</button>
				)}
				{phase !== 'idle' && phase !== 'offline' && <Meter phase={phase} level={voice.level} />}
				{build && <span className="build-bar" role="progressbar" aria-label={buildText ?? 'Building'} />}
				{state.busy && (
					<button
						className="tap pop flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--fill)] text-[var(--label)] transition-colors duration-150 hover:bg-[var(--fill-strong)] active:scale-95"
						onClick={onStop}
						title="Stop"
						aria-label="Stop agent"
					>
						<StopIcon className="h-3.5 w-3.5" />
					</button>
				)}
				{voice.supported && (
					<button
						onClick={voice.toggleMic}
						className={`voice-mic tap relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-[background-color,transform,box-shadow] duration-200 active:scale-95 ${
							voice.listening ? 'is-on bg-[var(--red)] text-white' : 'bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)]'
						}`}
						title={voice.listening ? 'Stop the voice conversation' : `Talk to ${AGENT_NAME}`}
						aria-label={voice.listening ? 'Stop voice conversation' : 'Start voice conversation'}
						aria-pressed={voice.listening}
						data-testid="voice-dock-mic"
					>
						{voice.listening && (
							<span className="absolute inset-0 rounded-full bg-[var(--red)] opacity-30 transition-transform duration-75" style={{ transform: `scale(${1 + voice.level * 0.9})` }} />
						)}
						<MicIcon className="relative h-5 w-5" />
					</button>
				)}
			</div>
		</div>
	)
}
