import type { WebSocket } from 'ws'
import type {
	Author,
	ClientMessage,
	Participant,
	ReviewMode,
	ServerMessage,
	ToolResult,
} from '../../shared/protocol.ts'
import { ALL_TOOLS, SERVER_TOOLS } from '../../shared/tools.ts'
import type { ChatMessage, CompletionOptions, ContentPart, LLMProvider, ToolCall } from './llm.ts'
import { SYSTEM_PROMPT } from './prompt.ts'
import type { ChangeEntry, Room } from './rooms.ts'
import { stripId } from './shapes.ts'
import type { VoiceService } from './voice.ts'

type Client = Participant & { ws: WebSocket }

type Trigger =
	| { kind: 'message'; from: Client; text: string; selection: string[] }
	| { kind: 'check_work'; from: Client; shapeIds: string[] }
	| { kind: 'idle'; from: Client | null }

export type AgentOptions = {
	maxSteps?: number
	idleMs?: number
	toolTimeoutMs?: number
	confirmTimeoutMs?: number
	/** Upper bound on waiting for a client to finish speaking a line. */
	maxSpeechWaitMs?: number
	/** Whether clients may start live (speech-to-speech) voice sessions. */
	realtime?: boolean
}

const MAX_HISTORY = 60

// Spoken the moment a student finishes talking, while Grok thinks, so the
// conversation never goes silent. Their audio is synthesized once and cached.
export const ACKS = ['Sure.', 'Good question.', 'Okay, let me sketch that.', 'Mm, let me think.', "Great, let's see."]
export const REVIEW_ACK = 'Let me take a look.'

/**
 * The agent for one room. It joins the room as a participant: it listens to
 * student edits, runs the Grok tool loop, and has a connected browser (the
 * "driver") apply its drawing tool calls to the shared tldraw document, which
 * then syncs to every participant.
 */
export class AgentSession {
	private clients = new Map<WebSocket, Client>()
	private history: ChatMessage[] = []
	private mode: ReviewMode = 'on_request'
	private busy = false
	private abort: AbortController | null = null
	private queued: Trigger | null = null
	private pendingCalls = new Map<string, { resolve: (r: ToolResult) => void; ws: WebSocket }>()
	private pendingSpeech = new Map<string, () => void>()
	private lastReviewAt = 0
	private lastEditorId: string | null = null
	private idleTimer: NodeJS.Timeout | null = null
	private callSeq = 0
	private opts: Required<AgentOptions>

	constructor(
		private room: Room,
		private provider: LLMProvider,
		opts: AgentOptions = {},
		private voice: VoiceService | null = null
	) {
		this.opts = {
			maxSteps: 12,
			idleMs: 4000,
			toolTimeoutMs: 30_000,
			confirmTimeoutMs: 90_000,
			maxSpeechWaitMs: 20_000,
			realtime: false,
			...opts,
		}
		room.onChanges((entries) => this.onBoardChanged(entries))
	}

	// ---------------------------------------------------------------- clients

	addClient(ws: WebSocket) {
		ws.on('message', (raw) => {
			let msg: ClientMessage
			try {
				msg = JSON.parse(raw.toString())
			} catch {
				return
			}
			this.handle(ws, msg)
		})
		ws.on('close', () => this.removeClient(ws))
	}

	private removeClient(ws: WebSocket) {
		this.clients.delete(ws)
		for (const [id, p] of this.pendingCalls) {
			if (p.ws === ws) {
				this.pendingCalls.delete(id)
				p.resolve({ ok: false, error: 'The student whose browser was running this tool disconnected.' })
			}
		}
		this.broadcastState()
	}

	private handle(ws: WebSocket, msg: ClientMessage) {
		if (msg.type === 'hello') {
			this.clients.set(ws, { ws, userId: msg.userId, name: msg.name.slice(0, 40) || 'Student', color: msg.color })
			this.broadcastState()
			return
		}
		const client = this.clients.get(ws)
		if (!client) return
		switch (msg.type) {
			case 'user_message': {
				const text = msg.text.trim().slice(0, 4000)
				if (!text) return
				this.broadcast({ type: 'chat', from: client.name, text })
				// Barge-in: a new utterance interrupts whatever the agent is saying.
				if (this.busy) this.stop()
				this.trigger({ kind: 'message', from: client, text, selection: msg.selection ?? [] })
				return
			}
			case 'check_work':
				this.broadcast({ type: 'chat', from: client.name, text: '✅ Check my work' })
				this.trigger({ kind: 'check_work', from: client, shapeIds: msg.shapeIds ?? [] })
				return
			case 'set_mode':
				if (['on_request', 'proactive', 'exercise'].includes(msg.mode)) this.mode = msg.mode
				this.broadcastState()
				return
			case 'tool_result': {
				const p = this.pendingCalls.get(msg.callId)
				if (p && p.ws === ws) {
					this.pendingCalls.delete(msg.callId)
					p.resolve(msg.result)
				}
				return
			}
			case 'speech_done':
				this.pendingSpeech.get(msg.sayId)?.()
				return
			case 'agent_cursor':
				this.broadcast({ type: 'agent_cursor', x: msg.x, y: msg.y }, ws)
				return
			case 'stop':
				this.stop()
				return
		}
	}

	private send(ws: WebSocket, msg: ServerMessage) {
		if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
	}

	private broadcast(msg: ServerMessage, except?: WebSocket) {
		for (const ws of this.clients.keys()) if (ws !== except) this.send(ws, msg)
	}

	private broadcastState() {
		this.broadcast({
			type: 'room_state',
			mode: this.mode,
			busy: this.busy,
			participants: [...this.clients.values()].map(({ userId, name, color }) => ({ userId, name, color })),
			provider: this.provider.name,
			voice: this.voice ? 'grok' : 'browser',
			realtime: this.opts.realtime,
		})
	}

	private status(activity: string) {
		this.broadcast({ type: 'agent_status', busy: this.busy, activity })
	}

	// ------------------------------------------------------- observation

	private onBoardChanged(entries: ChangeEntry[]) {
		const userEntries = entries.filter((e) => e.author?.kind === 'user')
		if (!userEntries.length) return
		this.lastEditorId = userEntries[userEntries.length - 1].author!.id
		if (this.mode !== 'proactive') return
		// Debounce: wait until students pause before looking.
		if (this.idleTimer) clearTimeout(this.idleTimer)
		this.idleTimer = setTimeout(() => {
			this.idleTimer = null
			if (this.busy || !this.room.changesSince(this.lastReviewAt).length) return
			this.trigger({ kind: 'idle', from: this.clientByUserId(this.lastEditorId) })
		}, this.opts.idleMs)
	}

	private clientByUserId(userId: string | null) {
		return [...this.clients.values()].find((c) => c.userId === userId) ?? null
	}

	private pickDriver(preferred: Client | null): Client | null {
		if (preferred && this.clients.has(preferred.ws)) return preferred
		return this.clientByUserId(this.lastEditorId) ?? this.clients.values().next().value ?? null
	}

	// --------------------------------------------------------------- turns

	private trigger(t: Trigger) {
		if (this.busy) {
			// Proactive wake-ups are dropped while busy; explicit requests wait their turn.
			if (t.kind !== 'idle') this.queued = t
			return
		}
		void this.runTurn(t)
	}

	stop() {
		this.abort?.abort()
		for (const [id, p] of this.pendingCalls) {
			this.pendingCalls.delete(id)
			p.resolve({ ok: false, error: 'Interrupted by a student.' })
		}
		for (const done of this.pendingSpeech.values()) done()
		this.broadcast({ type: 'stop_speech' })
	}

	private async runTurn(trigger: Trigger) {
		this.busy = true
		const abort = new AbortController()
		this.abort = abort
		this.broadcastState()
		let driver = this.pickDriver(trigger.from)
		let speech: Promise<void> = Promise.resolve()
		try {
			if (!driver) throw new Error('No connected browser to draw with.')
			// Acknowledge right away; Grok's first sentence follows it.
			let ack: string | null = null
			if (trigger.kind !== 'idle') {
				ack = trigger.kind === 'check_work' ? REVIEW_ACK : ACKS[Math.floor(Math.random() * ACKS.length)]
				speech = this.say(ack, driver, { ephemeral: true, cached: true })
			}
			const effort: CompletionOptions['reasoningEffort'] =
				trigger.kind === 'message'
					? ((process.env.XAI_REASONING_EFFORT as any) ?? 'low')
					: ((process.env.XAI_REVIEW_REASONING_EFFORT as any) ?? 'medium')
			// Fast spoken opener: starts answering ~1s after the question, while the
			// drawing model (slower, it reasons) prepares the first drawing step.
			let opener = ''
			if (trigger.kind === 'message' && this.provider.opener) {
				const afterAck = speech
				const lines: Promise<void>[] = []
				this.status('Thinking…')
				try {
					opener = await this.provider.opener(this.history, `${trigger.from.name}: ${trigger.text}`, abort.signal, (sentence) => {
						const line = this.prepareLine(sentence)
						lines.push(afterAck.then(() => (abort.signal.aborted ? undefined : this.say(sentence, driver!, { line }))))
					})
				} catch (err) {
					if (!abort.signal.aborted) console.warn('[agent] opener failed:', (err as Error).message)
				}
				if (lines.length) speech = Promise.all(lines).then(() => undefined)
			}
			this.status('Looking at the board…')
			const triggerMessage = await this.buildTriggerMessage(trigger, driver, abort.signal)
			const said = [ack, opener.trim()].filter(Boolean).join(' ')
			const note = opener.trim()
				? `(You already said this out loud: "${said}". Continue from there: draw it step by step and speak only NEW sentences; never repeat what you already said.)`
				: `(The student just heard you say "${ack}". Now speak your first explanatory sentence while you draw; don't repeat "${ack}".)`
			if (ack && typeof triggerMessage.content === 'string') triggerMessage.content += `\n${note}`
			else if (ack && Array.isArray(triggerMessage.content)) triggerMessage.content.push({ type: 'text', text: note })
			this.pushHistory(triggerMessage)

			for (let step = 0; step < this.opts.maxSteps && !abort.signal.aborted; step++) {
				this.status('Thinking…')
				const stepStart = Date.now()
				const debug = (msg: string) => process.env.AGENT_DEBUG && console.log(`[agent] step ${step} +${Date.now() - stepStart}ms ${msg}`)
				// The previous step's line must finish before this step speaks or draws, so the
				// drawing stays in step with the voice. Within a step, the line plays while its
				// tool calls run, and each call runs as soon as it streams in.
				const previous = speech
				const lines: Promise<void>[] = []
				// The first step draws right away, while the opener is still talking ("let me sketch it").
				let tools: Promise<void> = step === 0 ? Promise.resolve() : previous
				const results: { call: ToolCall; result: ToolResult }[] = []
				let toolError: unknown = null
				const { text, toolCalls } = await this.provider.complete(
					[{ role: 'system', content: SYSTEM_PROMPT }, ...this.history],
					ALL_TOOLS,
					abort.signal,
					{
						// Each sentence goes to the voice as soon as it streams in; they play in order,
						// after the previous step's speech.
						onSentence: (sentence) => {
							if (/^SILENT\b/.test(sentence)) return
							debug(`sentence: ${sentence.slice(0, 40)}`)
							const line = this.prepareLine(sentence)
							lines.push(previous.then(() => (abort.signal.aborted ? undefined : this.say(sentence, driver!, { line }))))
						},
						onText: (t) => debug(`text done (${t.length} chars)`),
						onToolCall: (call) => {
							tools = tools.then(async () => {
								if (abort.signal.aborted) return
								driver = this.pickDriver(driver)
								if (!driver) throw new Error('No connected browser to draw with.')
								this.status(`Running ${call.function.name}…`)
								results.push({ call, result: await this.executeTool(call, driver) })
							}).catch((err) => {
								toolError ??= err
							})
						},
					},
					{ reasoningEffort: effort }
				)
				debug(`stream done: ${toolCalls.length} tool call(s)`)
				// Safety net: if Grok drew without saying anything, narrate what appeared so the
				// voice never goes quiet while the board changes.
				if (!lines.length && toolCalls.length && !abort.signal.aborted) {
					const narration = narrateDrawing(toolCalls)
					if (narration) {
						debug(`narrating silent step: ${narration}`)
						const line = this.prepareLine(narration)
						lines.push(previous.then(() => (abort.signal.aborted ? undefined : this.say(narration, driver!, { line }))))
					}
				}
				await tools
				debug('tools done')
				if (toolError) throw toolError
				speech = lines.length ? Promise.all(lines).then(() => undefined) : previous
				if (abort.signal.aborted) break
				// An empty final reply (no text, no tools) is not a valid history entry for the API.
				if (text || toolCalls.length) {
					this.pushHistory({ role: 'assistant', content: text ?? '', ...(toolCalls.length ? { tool_calls: toolCalls } : {}) })
				}
				if (!toolCalls.length) break

				const images: ContentPart[] = []
				for (const call of toolCalls) {
					const result = results.find((r) => r.call.id === call.id)?.result ?? { ok: false, error: 'Not run.' }
					this.pushHistory({ role: 'tool', tool_call_id: call.id, content: formatToolResult(result) })
					if (result.image) images.push({ type: 'image_url', image_url: { url: result.image, detail: 'high' } })
				}
				// Tool messages can't carry images in this API, so attach them as a follow-up user message.
				if (images.length) {
					this.pushHistory({ role: 'user', content: [{ type: 'text', text: 'Canvas image(s) you requested:' }, ...images] })
				}
			}
			await speech
		} catch (err: any) {
			if (!abort.signal.aborted) {
				console.error('[agent]', err)
				this.broadcast({ type: 'error', message: err?.message ?? String(err) })
			}
		} finally {
			this.abort = null
			this.busy = false
			this.status('')
			this.broadcastState()
			const next = this.queued
			this.queued = null
			if (next) void this.runTurn(next)
		}
	}

	/**
	 * Builds the user message that starts a turn. For reviews, the canvas context
	 * (structured state, recent changes, and an image when there is freehand ink)
	 * is gathered up front so the model can respond without extra round trips.
	 */
	private async buildTriggerMessage(t: Trigger, driver: Client, signal: AbortSignal): Promise<ChatMessage> {
		const others = [...this.clients.values()].map((c) => c.name).join(', ')
		const header = `Mode: ${this.mode}. Students in the room: ${others || 'none'}.`
		if (t.kind === 'message') {
			const changes = this.takeRecentChanges()
			const sel = t.selection.length ? `\n${t.from.name} has selected: ${t.selection.map(stripId).join(', ')}.` : ''
			const ch = changes.total ? `\nStudent edits since you last looked: ${JSON.stringify(changes.byUser)}` : ''
			return { role: 'user', content: `[trigger:message] ${header}${sel}${ch}\n${t.from.name} says: ${t.text}` }
		}

		const scope = t.kind === 'check_work' && t.shapeIds.length ? { shapeIds: t.shapeIds.map(stripId) } : {}
		const state = await this.callClient(driver, 'get_canvas_state', scope, signal)
		const changes = this.takeRecentChanges()
		const parts: ContentPart[] = []
		const intro =
			t.kind === 'check_work'
				? `[trigger:check_work] ${header}\n${t.from.name} pressed "Check my work"${
						t.shapeIds.length ? ' with a selection (review only those shapes)' : ''
					}. Review their drawing and give feedback by voice AND on the board: point at the specific shapes you are talking about with highlight_shapes and/or add_comment (and suggest_correction for a concrete fix).`
				: `[trigger:idle] ${header}\nStudents paused after editing the board. Decide whether to comment (proactive mode).`
		parts.push({
			type: 'text',
			text: `${intro}\nCanvas state: ${formatToolResult(state)}\nRecent student edits: ${JSON.stringify(changes.byUser)}`,
		})
		const shapes: any[] = (state.data as any)?.shapes ?? []
		if (shapes.some((s) => s.author?.kind === 'user' && s.type === 'draw')) {
			const img = await this.callClient(driver, 'get_canvas_image', scope, signal)
			if (img.image) {
				parts.push({ type: 'text', text: 'Image of the board (contains freehand ink):' })
				parts.push({ type: 'image_url', image_url: { url: img.image, detail: 'high' } })
			}
		}
		return { role: 'user', content: parts }
	}

	private takeRecentChanges(since?: number) {
		const entries = this.room.changesSince(since ?? this.lastReviewAt)
		this.lastReviewAt = Date.now()
		// Collapse repeated updates (e.g., a drag) to the last state per shape.
		const latest = new Map<string, ChangeEntry>()
		for (const e of entries) {
			const prev = latest.get(e.shape.id)
			latest.set(e.shape.id, prev?.op === 'created' && e.op === 'updated' ? { ...e, op: 'created' } : e)
		}
		const byUser: Record<string, { op: string; shape: unknown }[]> = {}
		for (const e of latest.values()) {
			const who = e.author?.name ?? 'unknown'
			;(byUser[who] ??= []).push({ op: e.op, shape: e.shape })
		}
		return { total: latest.size, byUser }
	}

	private pushHistory(msg: ChatMessage) {
		this.history.push(msg)
		if (this.history.length <= MAX_HISTORY) return
		// Trim from the front, never leaving an orphaned tool result at the start.
		let cut = this.history.length - MAX_HISTORY
		while (cut < this.history.length && this.history[cut].role !== 'user') cut++
		this.history.splice(0, cut)
		// Old images are large and stale; keep only those from the latest few messages.
		for (const m of this.history.slice(0, -6)) {
			if (m.role === 'user' && Array.isArray(m.content)) {
				m.content = m.content.map((p) =>
					p.type === 'image_url' ? { type: 'text', text: '[earlier canvas image omitted]' } : p
				)
			}
		}
	}

	// --------------------------------------------------------------- speech

	/** Starts synthesizing a line now, so its audio is ready by the time it's due to play. */
	private prepareLine(text: string, cached = false) {
		const sayId = `say_${++this.callSeq}`
		const audioUrl = cached ? this.voice?.prepareCached(text) : this.voice?.prepare(`${this.room.id}-${sayId}`, text)
		return { sayId, audioUrl }
	}

	private say(
		text: string,
		driver: Client,
		opts: { ephemeral?: boolean; cached?: boolean; line?: { sayId: string; audioUrl?: string } } = {}
	): Promise<void> {
		const { sayId, audioUrl } = opts.line ?? this.prepareLine(text, opts.cached)
		const ephemeral = opts.ephemeral || undefined
		this.broadcast({ type: 'agent_say', sayId, text, report: false, audioUrl, ephemeral }, driver.ws)
		this.send(driver.ws, { type: 'agent_say', sayId, text, report: true, audioUrl, ephemeral })
		// The driver reports when it finishes speaking (immediately if muted); this is only a safety net.
		const timeoutMs = Math.min(this.opts.maxSpeechWaitMs, 3000 + text.split(/\s+/).length * 600)
		return new Promise<void>((resolve) => {
			const done = () => {
				clearTimeout(timer)
				this.pendingSpeech.delete(sayId)
				resolve()
			}
			const timer = setTimeout(done, this.clients.has(driver.ws) ? timeoutMs : 0)
			this.pendingSpeech.set(sayId, done)
		})
	}

	// ---------------------------------------------------------------- tools

	private async executeTool(call: ToolCall, driver: Client): Promise<ToolResult> {
		const name = call.function.name
		let args: Record<string, any>
		try {
			args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
		} catch {
			return { ok: false, error: 'Arguments were not valid JSON.' }
		}
		if (!ALL_TOOLS.some((t) => t.name === name)) return { ok: false, error: `Unknown tool ${name}` }

		if (SERVER_TOOLS.has(name)) {
			const since = args.since ? Date.parse(args.since) : undefined
			return { ok: true, data: this.takeRecentChanges(Number.isNaN(since) ? undefined : since) }
		}

		const confirm = this.guard(name, args)
		if (process.env.AGENT_DEBUG) console.log(`[agent] ${name} ${JSON.stringify(args).slice(0, 300)}${confirm ? ' (needs confirmation)' : ''}`)
		const result = await this.callClient(driver, name, args, this.abort?.signal, confirm)
		if (name === 'focus_view' && result.ok && args.scope === 'everyone') {
			this.broadcast({ type: 'focus', shapeIds: args.shapeIds ?? [], zoomLevel: args.zoomLevel }, driver.ws)
		}
		return result
	}

	/**
	 * Server-side enforcement of "respect student work": any call that would
	 * change or remove a student-authored shape needs a student's explicit OK.
	 */
	guard(name: string, args: Record<string, any>): { message: string } | undefined {
		const userOwned = (ids: string[]) =>
			ids.filter((id) => this.room.getAuthor(id)?.kind === 'user').map((id) => ({ id, author: this.room.getAuthor(id)! }))
		let touched: { id: string; author: Author }[] = []
		let verb = 'change'
		if (name === 'update_shape' || name === 'create_shape') {
			touched = userOwned([String(args.id ?? '')])
		} else if (name === 'clear_canvas') {
			verb = 'erase'
			if (args.mode === 'agent_only') return undefined
			const ids: string[] =
				args.mode === 'all' && !args.ids?.length
					? [...this.room.shapes.keys()].map(stripId)
					: (args.ids ?? []).map((id: string) => stripId(String(id)))
			touched = userOwned(ids)
		}
		if (!touched.length) return undefined
		const owners = [...new Set(touched.map((t) => t.author.name))].join(', ')
		return {
			message: `Professor Grok wants to ${verb} ${touched.length} shape(s) drawn by ${owners}. Allow?`,
		}
	}

	private callClient(
		driver: Client,
		name: string,
		args: Record<string, any>,
		signal?: AbortSignal,
		confirm?: { message: string }
	): Promise<ToolResult> {
		const callId = `call_${++this.callSeq}`
		const timeoutMs = confirm ? this.opts.confirmTimeoutMs : this.opts.toolTimeoutMs
		return new Promise<ToolResult>((resolve) => {
			const timer = setTimeout(() => {
				this.pendingCalls.delete(callId)
				resolve({ ok: false, error: `${name} timed out.` })
			}, timeoutMs)
			const finish = (r: ToolResult) => {
				clearTimeout(timer)
				resolve(r)
			}
			if (signal?.aborted) return finish({ ok: false, error: 'Interrupted.' })
			this.pendingCalls.set(callId, { resolve: finish, ws: driver.ws })
			this.send(driver.ws, { type: 'tool_call', callId, name, args, ...(confirm ? { confirm } : {}) })
		})
	}
}

/** A short spoken line describing what a silent drawing step added ("Here's the cache and the database."). */
export function narrateDrawing(calls: ToolCall[]): string | null {
	const labels: string[] = []
	for (const c of calls) {
		let args: any
		try {
			args = JSON.parse(c.function.arguments || '{}')
		} catch {
			continue
		}
		if (c.function.name === 'create_shape' && typeof args.label === 'string' && args.label.trim()) labels.push(args.label.trim().split('\n')[0])
		else if (c.function.name === 'draw_array' && Array.isArray(args.values)) labels.push('the array')
	}
	const unique = [...new Set(labels)].slice(0, 4)
	if (!unique.length) return null
	const list = unique.length === 1 ? unique[0] : `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`
	return `Here's ${list}.`
}

function formatToolResult(r: ToolResult): string {
	const body = r.ok
		? { ok: true, ...(r.data && typeof r.data === 'object' ? r.data : { result: r.data ?? 'done' }), ...(r.image ? { image: 'attached below' } : {}) }
		: { ok: false, error: r.error }
	const s = JSON.stringify(body)
	return s.length > 12_000 ? `${s.slice(0, 12_000)}…(truncated)` : s
}
