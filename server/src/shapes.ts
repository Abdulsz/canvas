// Lightweight helpers for reading raw tldraw shape records on the server
// (the server has no Editor instance, only the synced records).

export type ShapeRecord = {
	id: string
	typeName: 'shape'
	type: string
	x: number
	y: number
	parentId: string
	props: Record<string, any>
	meta: Record<string, any>
}

export type ShapeSummary = {
	id: string
	type: string
	geo?: string
	label?: string
	x: number
	y: number
}

/** Extracts plain text from a TipTap rich-text document. */
export function richTextToPlain(node: any): string {
	if (!node || typeof node !== 'object') return ''
	if (node.type === 'text') return node.text ?? ''
	const children: any[] = node.content ?? []
	const sep = node.type === 'doc' ? '\n' : ''
	return children.map(richTextToPlain).join(sep)
}

export function shapeLabel(shape: ShapeRecord): string {
	const p = shape.props ?? {}
	if (p.richText) return richTextToPlain(p.richText).trim()
	if (typeof p.text === 'string') return p.text.trim()
	return ''
}

export const stripId = (id: string) => id.replace(/^shape:/, '')

export function summarizeShape(shape: ShapeRecord): ShapeSummary {
	const label = shapeLabel(shape)
	return {
		id: stripId(shape.id),
		type: shape.type,
		...(shape.props?.geo ? { geo: shape.props.geo } : {}),
		...(label ? { label } : {}),
		x: Math.round(shape.x),
		y: Math.round(shape.y),
	}
}
