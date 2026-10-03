import { useState } from 'react'
import { Board } from './Board.tsx'
import { getRoomId, loadIdentity, saveIdentity, type Identity } from './identity.ts'

const roomId = getRoomId()

export function App() {
	const [me, setMe] = useState<Identity | null>(() => loadIdentity())
	const [name, setName] = useState(me?.name ?? '')

	if (!me) {
		return (
			<div className="flex h-full items-center justify-center bg-slate-50 px-4">
				<form
					className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
					onSubmit={(e) => {
						e.preventDefault()
						setMe(saveIdentity(name))
					}}
				>
					<h1 className="text-lg font-semibold text-slate-900">Join the whiteboard</h1>
					<p className="mt-1 text-sm text-slate-500">
						Room <span className="font-mono">{roomId}</span>. Your name is shown to others and to Professor Grok.
					</p>
					<input
						autoFocus
						className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-violet-500"
						placeholder="Your name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						aria-label="Your name"
					/>
					<button className="mt-4 w-full rounded-lg bg-violet-600 px-3 py-2 font-medium text-white hover:bg-violet-700" type="submit">
						Join
					</button>
				</form>
			</div>
		)
	}
	return <Board roomId={roomId} me={me} />
}
