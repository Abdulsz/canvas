export type Identity = { userId: string; name: string; color: string }

const KEY = 'grok-whiteboard:identity'
const COLORS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#0c8599', '#c2255c', '#5f3dc4', '#495057']

export function loadIdentity(): Identity | null {
	try {
		const raw = localStorage.getItem(KEY)
		if (raw) return JSON.parse(raw)
	} catch {}
	return null
}

export function saveIdentity(name: string): Identity {
	const existing = loadIdentity()
	const identity: Identity = {
		userId: existing?.userId ?? crypto.randomUUID(),
		name: name.trim().slice(0, 40) || 'Student',
		color: existing?.color ?? COLORS[Math.floor(Math.random() * COLORS.length)],
	}
	try {
		localStorage.setItem(KEY, JSON.stringify(identity))
	} catch {}
	return identity
}

/** Room id from /r/<id>; creates a new room (and updates the URL) when missing. */
export function getRoomId(): string {
	const m = location.pathname.match(/^\/r\/([a-zA-Z0-9_-]{1,64})$/)
	if (m) return m[1]
	const id = crypto.randomUUID().slice(0, 8)
	history.replaceState(null, '', `/r/${id}`)
	return id
}
