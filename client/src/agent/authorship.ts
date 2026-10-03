import type { Editor, TLShape } from 'tldraw'
import { AGENT_NAME, type Author } from '../../../shared/protocol.ts'
import type { Identity } from '../identity.ts'

export const AGENT_AUTHOR: Author = { kind: 'agent', id: 'agent', name: AGENT_NAME }

// While > 0, edits made in this tab are the agent's (the tab is executing a tool call).
let agentDepth = 0

export function asAgent<T>(fn: () => T): T {
	agentDepth++
	try {
		return fn()
	} finally {
		agentDepth--
	}
}

export const authorOf = (shape: TLShape) => (shape.meta?.author as Author | undefined) ?? null

/**
 * Stamps every shape created or edited from this tab with who did it, so the
 * agent (and the server's guard) can tell student work from its own.
 * Remote changes arrive with source 'remote' and are left untouched.
 */
export function registerAuthorship(editor: Editor, me: Identity) {
	const userAuthor: Author = { kind: 'user', id: me.userId, name: me.name }
	const current = () => (agentDepth > 0 ? AGENT_AUTHOR : userAuthor)

	const offCreate = editor.sideEffects.registerBeforeCreateHandler('shape', (shape, source) => {
		if (source !== 'user') return shape
		const author = current()
		const now = Date.now()
		return { ...shape, meta: { ...shape.meta, author, createdAt: now, updatedBy: author, updatedAt: now } }
	})
	const offChange = editor.sideEffects.registerBeforeChangeHandler('shape', (prev, next, source) => {
		if (source !== 'user' || prev === next) return next
		return { ...next, meta: { ...next.meta, updatedBy: current(), updatedAt: Date.now() } }
	})
	return () => {
		offCreate()
		offChange()
	}
}
