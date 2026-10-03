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
import type { ChatMessage, ContentPart, LLMProvider, ToolCall } from './llm.ts'
import { SYSTEM_PROMPT } from './prompt.ts'
import type { ChangeEntry, Room } from './rooms.ts'
import { stripId } from './shapes.ts'

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
}

const MAX_HISTORY = 60

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
		opts: AgentOptions = {}
	) {
		this.opts = {
			maxSteps: 12,
			idleMs: 4000,
			toolTimeoutMs: 30_000,
			confirmTimeoutMs: 90_000,
			maxSpeechWaitMs: 20_000,
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
			this.status('Looking at the board…')
			this.pushHistory(await this.buildTriggerMessage(trigger, driver, abort.signal))

			for (let step = 0; step < this.opts.maxSteps && !abort.signal.aborted; step++) {
				this.status('Thinking…')
				const { text, toolCalls } = await this.provider.complete(
					[{ role: 'system', content: SYSTEM_PROMPT }, ...this.history],
					ALL_TOOLS,
					abort.signal
				)
				// An empty final reply (no text, no tools) is not a valid history entry for the API.
				if (text || toolCalls.length) {
					this.pushHistory({ role: 'assistant', content: text ?? '', ...(toolCalls.length ? { tool_calls: toolCalls } : {}) })
				}

				// Let the previous line finish so drawing stays in step with the voice.
				await speech
				if (abort.signal.aborted) break
				const spoken = text?.trim()
				if (spoken && spoken !== 'SILENT') speech = this.say(spoken, driver)
				if (!toolCalls.length) break

				const images: ContentPart[] = []
				for (const call of toolCalls) {
					if (abort.signal.aborted) break
					driver = this.pickDriver(driver)
					if (!driver) throw new Error('No connected browser to draw with.')
					this.status(`Running ${call.function.name}…`)
					const result = await this.executeTool(call, driver)
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
					}. Review their drawing and give feedback by voice and on the board.`
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

	private say(text: string, driver: Client): Promise<void> {
		const sayId = `say_${++this.callSeq}`
		this.broadcast({ type: 'agent_say', sayId, text, report: false }, driver.ws)
		this.send(driver.ws, { type: 'agent_say', sayId, text, report: true })
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

function formatToolResult(r: ToolResult): string {
	const body = r.ok
		? { ok: true, ...(r.data && typeof r.data === 'object' ? r.data : { result: r.data ?? 'done' }), ...(r.image ? { image: 'attached below' } : {}) }
		: { ok: false, error: r.error }
	const s = JSON.stringify(body)
	return s.length > 12_000 ? `${s.slice(0, 12_000)}…(truncated)` : s
}
