import type { TLShape } from 'tldraw'
import { bareId, isUi } from '../design/tree.ts'

/** "login_primary_btn" under screen "login" -> "Primary btn". */
function humanize(id: string, screenId: string | null) {
	let s = id
	if (screenId && s !== screenId && s.startsWith(`${screenId}_`)) s = s.slice(screenId.length + 1)
	s = s.replace(/[_-]+/g, ' ').trim()
	return s ? s[0].toUpperCase() + s.slice(1) : id
}

/**
 * Display name of a layer: its name; when the name is just its id (agent
 * nodes), the visible text for text-like nodes, else the id made readable.
 */
export function layerName(shape: TLShape, screenId: string | null): string {
	if (isUi(shape)) {
		const p = shape.props
		const id = bareId(shape.id)
		if (p.name && p.name !== id) return p.name
		if (p.text && ['text', 'button', 'input', 'checkbox'].includes(p.kind)) return p.text
		return humanize(id, screenId)
	}
	const rt = (shape.props as any).richText
	const text = rt?.content?.[0]?.content?.[0]?.text as string | undefined
	const role = shape.meta?.role as string | undefined
	return text ? `${role === 'comment' ? 'Comment' : shape.type}: ${text}` : role === 'flow' ? 'Flow arrow' : shape.type
}

