import { useState } from 'react'
import { Board } from './Board.tsx'
import { AGENT_NAME } from '../../shared/protocol.ts'
import { Orb } from './components/AgentPanel.tsx'
import { getRoomId, loadIdentity, saveIdentity, suggestName, type Identity } from './identity.ts'

const roomId = getRoomId()

export function App() {
	const [me, setMe] = useState<Identity | null>(() => loadIdentity())
	const [name, setName] = useState(() => me?.name ?? suggestName())

	if (!me) {
		return (
			<div className="relative flex h-full items-center justify-center overflow-hidden bg-[var(--bg)] px-4">
				{/* Soft ambient color behind the glass card. */}
				<div className="pointer-events-none absolute -left-32 -top-32 h-[520px] w-[520px] rounded-full bg-[#5e5ce6] opacity-[0.18] blur-[120px]" />
				<div className="pointer-events-none absolute -bottom-40 -right-24 h-[560px] w-[560px] rounded-full bg-[#ff375f] opacity-[0.12] blur-[140px]" />
				<div className="pointer-events-none absolute bottom-10 left-1/3 h-[360px] w-[360px] rounded-full bg-[#64d2ff] opacity-[0.14] blur-[120px]" />

				<form
					className="material pop relative w-full max-w-[380px] rounded-[28px] px-8 pb-8 pt-10 text-center shadow-[var(--shadow-panel)]"
					onSubmit={(e) => {
						e.preventDefault()
						if (name.trim()) setMe(saveIdentity(name))
					}}
				>
					<div className="mx-auto w-fit">
						<Orb state="idle" size={64} />
					</div>
					<h1 className="mt-6 text-[28px] font-semibold leading-tight tracking-[-0.03em] text-[var(--label)]">Design out loud.</h1>
					<p className="mx-auto mt-2 max-w-[280px] text-[14px] leading-snug text-[var(--label-2)]">
						Describe screens and {AGENT_NAME} builds them with you, live, on a shared canvas.
					</p>
					<label htmlFor="display-name" className="mt-7 block text-left text-[13px] font-medium text-[var(--label-2)]">
						Your name <span className="font-normal">· shown to collaborators</span>
					</label>
					<input
						id="display-name"
						autoFocus
						onFocus={(e) => e.target.select()}
						maxLength={40}
						className="mt-1.5 h-12 w-full rounded-[14px] bg-[var(--card)] px-4 text-[16px] text-[var(--label)] shadow-[0_0_0_0.5px_var(--separator)] outline-none focus-visible:outline-none transition-shadow duration-150 placeholder:text-[var(--label-3)] focus:shadow-[0_0_0_2px_var(--focus)]"
						placeholder="Your name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						autoComplete="nickname"
						spellCheck={false}
					/>
					<button
						className="mt-3 h-12 w-full truncate rounded-[14px] px-4 bg-[var(--accent)] text-[15px] font-semibold text-[var(--on-accent)] transition-[background-color,transform] duration-150 hover:bg-[var(--accent-hover)] active:scale-[0.98] disabled:opacity-40"
						type="submit"
						disabled={!name.trim()}
					>
						{name.trim() ? `Join as ${name.trim()}` : 'Join'}
					</button>
					<p className="mt-5 text-[12px] text-[var(--label-3)]">
						Room <span className="font-mono tracking-normal">{roomId}</span>
					</p>
				</form>
			</div>
		)
	}
	return <Board roomId={roomId} me={me} />
}
