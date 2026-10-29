// Critique overlays: the agent's comment cards and the outlines it draws around
// the nodes it talks about. One custom tldraw shape ('critique'), registered on
// the client (client/src/design/CritiqueShapeUtil.tsx) and in the server schema.

import { richTextValidator } from '@tldraw/tlschema'
import { T } from '@tldraw/validate'

export type CritiqueTone = 'issue' | 'suggestion' | 'praise' | 'question'

export type CritiqueProps = {
	w: number
	h: number
	/** 'note': a comment card. 'highlight': an outline around a node. */
	kind: 'note' | 'highlight'
	tone: string
	/** The comment (notes): kept as rich text so layer lists and summaries read it like any tldraw text. */
	richText: any
	/** Who the comment is addressed to (shown in the card header). */
	to: string
	/** Notes scale with the zoom they were made at, so they stay readable. */
	scale: number
}

export const critiqueShapeProps = {
	w: T.number,
	h: T.number,
	kind: T.literalEnum('note', 'highlight'),
	tone: T.string,
	richText: richTextValidator,
	to: T.string,
	scale: T.number,
}

export const TONE_COLORS: Record<string, { light: string; dark: string; label: string }> = {
	issue: { light: '#dc2626', dark: '#f87171', label: 'Issue' },
	suggestion: { light: '#d97706', dark: '#fbbf24', label: 'Suggestion' },
	praise: { light: '#16a34a', dark: '#4ade80', label: 'Praise' },
	question: { light: '#2563eb', dark: '#60a5fa', label: 'Question' },
}

/** Tone of an add_comment kind or a highlight color ('red' = issue, 'green' = praise...). */
export function toneOf(kindOrColor: unknown): CritiqueTone {
	const k = String(kindOrColor ?? '')
	if (/^(issue|error|red|light-red|orange)$/.test(k)) return 'issue'
	if (/^(praise|green|light-green)$/.test(k)) return 'praise'
	if (/^(question|blue|light-blue|violet|light-violet)$/.test(k)) return 'question'
	return 'suggestion'
}

/** Card metrics in page units at scale 1 (the executor sizes the card with them). */
export const NOTE_METRICS = { width: 232, padX: 12, padY: 10, rule: 3, headerH: 16, gap: 4, fontSize: 13, lineHeight: 1.4 }
