import { useEffect, useState } from 'react'
import { AGENT_NAME } from '../../../shared/protocol.ts'
import type { AgentState } from '../agent/useAgent.ts'
import type { Voice } from '../agent/useVoice.ts'
import { Orb } from '../components/AgentPanel.tsx'
import { MicIcon, StopIcon } from '../components/icons.tsx'

/**
 * Voice-first control floating over the canvas: the agent's live status (orb +
 * what it is saying or doing) and the mic, which drives the same hands-free
 * conversation as the Agent tab's mic.
 */
export function VoiceDock({ state, voice, onOpenAgent, onStop }: { state: AgentState; voice: Voice; onOpenAgent: () => void; onStop: () => void }) {
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
				? voice.status
				: voice.listenState === 'hearing'
					? 'Hearing you…'
					: voice.listenState === 'transcribing'
						? 'Transcribing…'
						: voice.listening
							? 'Listening — describe a screen or an edit'
							: !state.connected
								? 'Connecting…'
								: null
	const active = !!caption
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-[92px] md:bottom-[68px] z-[300] flex justify-center px-3" data-testid="voice-dock">
			<div
				className={`material pointer-events-auto flex max-w-[min(560px,100%)] items-center gap-2.5 rounded-full p-1.5 shadow-[var(--shadow-panel)] transition-[padding] duration-300 ${active ? 'pl-2' : 'pl-1.5'}`}
			>
				<button className="shrink-0 rounded-full" onClick={onOpenAgent} title={`Open the ${AGENT_NAME} conversation`} aria-label={`Open ${AGENT_NAME} conversation`}>
					<Orb state={voice.orbState} size={30} />
				</button>
				{active ? (
					<button
						className="fade-up line-clamp-2 min-w-0 max-w-[420px] text-left text-[13px] leading-[1.3] text-[var(--label)]"
						onClick={onOpenAgent}
						data-testid="voice-caption"
						aria-live="polite"
						title={caption ?? undefined}
					>
						{caption}
					</button>
				) : (
					<span className="hidden pr-0.5 text-[13px] font-medium text-[var(--label-2)] sm:inline">Talk to design</span>
				)}
				{state.busy && (
					<button
						className="pop flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--fill)] text-[var(--label)] transition hover:bg-[var(--fill-2)] active:scale-95"
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
						className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.14),0_4px_14px_rgba(0,0,0,0.16)] transition active:scale-95 ${
							voice.listening ? 'bg-[var(--red)] text-white' : 'bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)]'
						}`}
						title={voice.listening ? 'Stop the voice conversation' : `Talk to ${AGENT_NAME}`}
						aria-label={voice.listening ? 'Stop voice conversation' : 'Start voice conversation'}
						aria-pressed={voice.listening}
						data-testid="voice-dock-mic"
					>
						{voice.listening && (
							<span className="absolute inset-0 rounded-full bg-[var(--red)] opacity-30 transition-transform duration-75" style={{ transform: `scale(${1 + voice.level * 0.9})` }} />
						)}
						<MicIcon className="relative h-[19px] w-[19px]" />
					</button>
				)}
			</div>
		</div>
	)
}
