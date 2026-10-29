import { AGENT_NAME } from '../../shared/protocol.ts'
import type { ToolDef } from '../../shared/tools.ts'

// OpenAI-compatible chat message shapes (xAI's API uses this format).
export type ContentPart =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string; detail?: 'high' | 'low' | 'auto' } }

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }

export type ChatMessage =
	| { role: 'system'; content: string }
	| { role: 'user'; content: string | ContentPart[] }
	| { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
	| { role: 'tool'; tool_call_id: string; content: string }

export type Completion = { text: string | null; toolCalls: ToolCall[] }

/** Streaming callbacks: lets the agent start speaking and drawing before the response finishes. */
export type StreamHandlers = {
	/** The spoken text for this step is final (fires once, before the first tool call or at the end). */
	onText?: (text: string) => void
	/** Each complete sentence of the spoken text, as soon as it has streamed in (lets speech start early). */
	onSentence?: (sentence: string) => void
	/** A complete tool call has arrived. */
	onToolCall?: (call: ToolCall) => void
}

export interface LLMProvider {
	readonly name: string
	/**
	 * Optional fast spoken opener: one or two sentences that start answering right
	 * away (from a non-reasoning model) while the drawing model works.
	 */
	opener?(context: ChatMessage[], question: string, signal: AbortSignal, onSentence: (s: string) => void): Promise<string>
	complete(messages: ChatMessage[], tools: ToolDef[], signal: AbortSignal, handlers?: StreamHandlers, opts?: CompletionOptions): Promise<Completion>
}

export type CompletionOptions = {
	/** grok-4.x reasoning depth. "low" answers in ~1s instead of ~4s, which matters for conversation. */
	reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
	/** Overrides the provider's model for this call (no reasoning effort is sent then). */
	model?: string
	/** Stable per-conversation id: xAI routes requests with the same id to warm prompt caches. */
	conversationId?: string
}

/** Accumulates OpenAI-style streamed deltas and reports text and tool calls as soon as each is complete. */
export class StreamAssembler {
	private text = ''
	private textSent = false
	private spokenUpTo = 0
	private calls = new Map<string | number, ToolCall>()
	private emitted = new Set<string | number>()
	private order: (string | number)[] = []

	constructor(private handlers: StreamHandlers = {}) {}

	/** Emits complete sentences (punctuation followed by whitespace); with `final`, also the remainder. */
	private emitSentences(final: boolean) {
		const rest = this.text.slice(this.spokenUpTo)
		const boundary = /[.!?]+["')\]]*\s+/g
		let cut = 0
		let m: RegExpExecArray | null
		while ((m = boundary.exec(rest))) {
			const end = m.index + m[0].length
			const sentence = rest.slice(cut, end).trim()
			if (sentence.length < 12) continue // too short to speak alone ("Ok.", "1."); merge with the next
			this.handlers.onSentence?.(sentence)
			cut = end
		}
		if (final && rest.slice(cut).trim()) {
			this.handlers.onSentence?.(rest.slice(cut).trim())
			cut = rest.length
		}
		this.spokenUpTo += cut
	}

	/**
	 * The text so far ends with a complete sentence but nothing has streamed for a
	 * moment (the model is now writing a tool call, which arrives in one piece):
	 * speak it now instead of waiting for the tool call.
	 */
	flushIdleSentence() {
		if (this.textSent) return
		const rest = this.text.slice(this.spokenUpTo)
		if (!/[.!?]["')\]]*\s*$/.test(rest) || rest.trim().length < 2) return
		this.handlers.onSentence?.(rest.trim())
		this.spokenUpTo = this.text.length
	}

	private flushText() {
		if (this.textSent) return
		this.textSent = true
		this.emitSentences(true)
		this.handlers.onText?.(this.text)
	}

	private tryEmit(key: string | number) {
		const call = this.calls.get(key)
		if (!call || this.emitted.has(key) || !call.function.name) return
		try {
			const args = call.function.arguments.trim()
			if (args && !args.endsWith('}')) return
			if (args) JSON.parse(args)
		} catch {
			return
		}
		this.emitted.add(key)
		this.flushText()
		this.handlers.onToolCall?.(call)
	}

	push(delta: any) {
		if (typeof delta?.content === 'string') {
			this.text += delta.content
			if (!this.textSent) this.emitSentences(false)
		}
		for (const tc of delta?.tool_calls ?? []) {
			const key = tc.index ?? tc.id ?? this.order.at(-1) ?? 0
			let call = this.calls.get(key)
			if (!call) {
				call = { id: tc.id ?? `call_${this.calls.size}`, type: 'function', function: { name: '', arguments: '' } }
				this.calls.set(key, call)
				this.order.push(key)
			}
			if (tc.id) call.id = tc.id
			if (tc.function?.name) call.function.name += tc.function.name
			if (tc.function?.arguments) call.function.arguments += tc.function.arguments
			this.tryEmit(key)
		}
	}

	finish(): Completion {
		this.flushText()
		for (const key of this.order) {
			if (this.emitted.has(key)) continue
			this.emitted.add(key)
			this.handlers.onToolCall?.(this.calls.get(key)!)
		}
		return { text: this.text || null, toolCalls: this.order.map((k) => this.calls.get(k)!) }
	}
}

export const OPENER_PROMPT = `You are ${AGENT_NAME}, a warm senior product designer pair-designing app screens out loud with a collaborator on a shared canvas.
Reply to the collaborator's latest message with ONE short spoken sentence (under 15 words) that starts answering, in plain speech with no markdown or lists.
Another process decides the actual design and builds it right after you speak. So only say, in your own words, WHAT you are about to make or change ("Okay, a calm onboarding screen for the meditation app, coming up."). Never describe how it will look (no colors, imagery, illustrations, backgrounds, layout, labels or names), never claim it is done, and don't ask a question.
New screens are added next to the existing ones; nothing is replaced or switched unless they ask for that. Match the scope they asked for: "everything" means all screens; don't name a screen they didn't name.
Examples: "Okay, a settings screen with those three sections, coming up." "Sure, giving the cards more room and trying a green accent." "On it, switching everything to dark mode."
If the message is just small talk or thanks, reply briefly and naturally.`

const VISUAL_WORDS = /\b(navy|teal|sage|emerald|indigo|violet|purple|blue|green|red|orange|yellow|pink|brown|gold|black|white|gr[ae]y|pastel|neon|gradient|background|header|illustration|photo|image|picture|landscape|icon|logo|font|serif|card|chart|graph|grid|sidebar|button|minimal|sleek|clean|serene|calm|soft|bold|dusk|dawn|cozy|warm|dark|light|deep|charcoal)s?\b|\b(added|done|ready|now has|is now|are now|applied)\b/gi

/** True when an opener sentence describes visuals the request didn't mention (only the design model knows those). */
export function inventsVisuals(sentence: string, request: string): boolean {
	const asked = request.toLowerCase()
	return (sentence.match(VISUAL_WORDS) ?? []).some((w) => !asked.includes(w.toLowerCase()))
}

export class GrokProvider implements LLMProvider {
	readonly name: string

	constructor(
		private apiKey: string,
		private model: string,
		private baseUrl = 'https://api.x.ai/v1',
		private openerModel: string | null = 'grok-4.20-non-reasoning'
	) {
		this.name = `xai:${model}`
		if (!openerModel) this.opener = undefined
	}

	async opener?(context: ChatMessage[], question: string, signal: AbortSignal, onSentence: (s: string) => void): Promise<string> {
		// Only the recent spoken conversation, as plain text: enough for continuity, small enough to be fast.
		const recent = context
			.filter((m): m is Extract<ChatMessage, { role: 'user' | 'assistant' }> => m.role === 'user' || m.role === 'assistant')
			.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content?.map((p) => (p.type === 'text' ? p.text : '')).join(' ') ?? '' }))
			.filter((m) => m.content.trim())
			.slice(-6)
			.map((m) => ({ ...m, content: m.content.slice(0, 1500) }))
		const res = await fetch(`${this.baseUrl}/chat/completions`, {
			method: 'POST',
			signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
			headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify({
				model: this.openerModel,
				stream: true,
				max_tokens: 60,
				messages: [{ role: 'system', content: OPENER_PROMPT }, ...recent, { role: 'user', content: question }],
			}),
		})
		if (!res.ok || !res.body) throw new Error(`xAI opener error ${res.status}`)
		// Speak at most two sentences, and no question: the drawing model asks the turn's
		// one question at the end. Returns exactly what was spoken.
		let spoken = ''
		let count = 0
		const assembler = new StreamAssembler({
			onSentence: (sentence) => {
				if (count >= 2 || /\?["')\]]*$/.test(sentence) || inventsVisuals(sentence, question)) return
				count++
				spoken = spoken ? `${spoken} ${sentence}` : sentence
				onSentence(sentence)
			},
		})
		const decoder = new TextDecoder()
		let buf = ''
		for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
			buf += decoder.decode(chunk, { stream: true })
			let nl: number
			while ((nl = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, nl).trim()
				buf = buf.slice(nl + 1)
				if (!line.startsWith('data:') || line.includes('[DONE]')) continue
				assembler.push(JSON.parse(line.slice(5)).choices?.[0]?.delta)
			}
		}
		assembler.finish()
		return spoken
	}

	async complete(messages: ChatMessage[], tools: ToolDef[], signal: AbortSignal, handlers?: StreamHandlers, opts?: CompletionOptions): Promise<Completion> {
		const res = await fetch(`${this.baseUrl}/chat/completions`, {
			method: 'POST',
			// Never let a stalled request freeze the conversation.
			signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
			headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}`, ...(opts?.conversationId ? { 'x-grok-conv-id': opts.conversationId } : {}) },
			body: JSON.stringify({
				model: opts?.model ?? this.model,
				messages,
				stream: true,
				// Non-reasoning models reject the parameter.
				...(opts?.reasoningEffort && !/non-reasoning/.test(opts?.model ?? this.model) ? { reasoning_effort: opts.reasoningEffort } : {}),
				tools: tools.map((t) => ({ type: 'function', function: t })),
				tool_choice: 'auto',
			}),
		})
		if (!res.ok || !res.body) {
			throw new Error(`xAI API error ${res.status}: ${(await res.text()).slice(0, 500)}`)
		}
		const assembler = new StreamAssembler(handlers)
		const decoder = new TextDecoder()
		let buf = ''
		let idle: NodeJS.Timeout | null = null
		try {
			for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
				buf += decoder.decode(chunk, { stream: true })
				let nl: number
				while ((nl = buf.indexOf('\n')) >= 0) {
					const line = buf.slice(0, nl).trim()
					buf = buf.slice(nl + 1)
					if (!line.startsWith('data:')) continue
					const data = line.slice(5).trim()
					if (data === '[DONE]') continue
					const json = JSON.parse(data)
					if (json.error) throw new Error(`xAI API error: ${JSON.stringify(json.error).slice(0, 500)}`)
					const delta = json.choices?.[0]?.delta
					assembler.push(delta)
					if (typeof delta?.content === 'string' && delta.content) {
						if (idle) clearTimeout(idle)
						idle = setTimeout(() => assembler.flushIdleSentence(), 350)
					}
				}
			}
		} finally {
			if (idle) clearTimeout(idle)
		}
		return assembler.finish()
	}
}
