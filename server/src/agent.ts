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
import { classifyScreenRequest, unsupportedClaim, type AuditIssue } from '../../shared/design.ts'
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

// Spoken the moment the user finishes talking, while Grok thinks, so the
// conversation never goes silent. Their audio is synthesized once and cached.
export const ACKS = ['Sure.', 'Got it.', 'Okay, let me sketch that.', 'Mm, let me think.', "Great, let's design it."]
export const REVIEW_ACK = 'Let me critique that.'

/**
 * The agent for one room. It joins the room as a participant: it listens to
 * collaborator edits, runs the Grok tool loop, and has a connected browser (the
 * "driver") apply its design tool calls to the shared tldraw document, which
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
	/** Measured problems on the canvas for the current critique turn (null outside critiques). */
	private turnAudit: AuditIssue[] | null = null
	/** Steering questions asked in earlier turns, so the next one is new. */
	private askedQuestions: string[] = []
	/** The request that started the current turn (to keep "everything" edits on every screen). */
	private turnRequest = ''
	/** Whether this turn's tool calls changed the canvas (a turn that did gets a steering question). */
	private turnChanged = false
	/** Lines of the current turn share this id (chat logs show them as one reply). */
	private turnId = ''
	/** Critique notes added this turn, by screen (critiques cover every screen with measured issues, 3-5 notes). */
	private turnComments: string[] = []
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
				p.resolve({ ok: false, error: 'The collaborator whose browser was running this tool disconnected.' })
			}
		}
		this.broadcastState()
	}

	private handle(ws: WebSocket, msg: ClientMessage) {
		if (msg.type === 'hello') {
			this.clients.set(ws, { ws, userId: msg.userId, name: msg.name.slice(0, 40) || 'Collaborator', color: msg.color })
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
				this.broadcast({ type: 'chat', from: client.name, text: 'Asked for a critique' })
				this.trigger({ kind: 'check_work', from: client, shapeIds: msg.shapeIds ?? [] })
				return
			case 'set_mode':
				if (['on_request', 'proactive', 'guided'].includes(msg.mode)) this.mode = msg.mode
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
		// Debounce: wait until collaborators pause before looking.
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
			p.resolve({ ok: false, error: 'Interrupted by a collaborator.' })
		}
		for (const done of this.pendingSpeech.values()) done()
		this.broadcast({ type: 'stop_speech' })
	}

	private async runTurn(trigger: Trigger) {
		this.busy = true
		this.turnId = `turn_${++this.callSeq}`
		this.turnComments = []
		const abort = new AbortController()
		this.abort = abort
		this.broadcastState()
		let driver = this.pickDriver(trigger.from)
		let speech: Promise<void> = Promise.resolve()
		let skeletonPlaced = false
		try {
			if (!driver) throw new Error('No connected browser to design with.')
			// Acknowledge right away; Grok's first sentence follows it.
			let ack: string | null = null
			if (trigger.kind !== 'idle') {
				ack = trigger.kind === 'check_work' ? REVIEW_ACK : ACKS[Math.floor(Math.random() * ACKS.length)]
				speech = this.say(ack, driver, { ephemeral: true, cached: true })
			}
			const effort: CompletionOptions['reasoningEffort'] =
				trigger.kind === 'message'
					? ((process.env.XAI_REASONING_EFFORT as any) ?? 'minimal')
					: ((process.env.XAI_REVIEW_REASONING_EFFORT as any) ?? 'low')
			// Small edits to existing screens go to the fast (non-reasoning) model:
			// it starts drawing in ~2s instead of ~7s. New screens and rebuilds keep the designer model.
			const editModel = process.env.XAI_EDIT_MODEL === 'off' ? undefined : (process.env.XAI_EDIT_MODEL ?? 'grok-4.20-non-reasoning')
			const model = trigger.kind === 'message' && editModel && this.provider.name.startsWith('xai:') && isQuickEdit(trigger.text, this.hasScreens()) ? editModel : undefined
			// Fast spoken opener: starts answering ~1s after the question. It runs in
			// parallel with the drawing model (which reasons, so it is slower to say
			// anything); the drawing model's lines play after it.
			let opener = ''
			let nudged = false
			// What gets said in a turn: one status line (the opener's, or the designer's when
			// the opener said nothing) and one steering question. Critiques get two lines
			// (praise, then the top issue). Measurable claims a critique can't back up, and
			// visual details nobody asked for, are never spoken.
			this.turnRequest = trigger.kind === 'message' ? trigger.text : ''
			const review = trigger.kind !== 'message' || isCritiqueRequest(trigger.text)
			const statusCap = review ? 2 : 1
			let statusCount = 0
			// A failed or declined change earns one more line ("Okay, I left that as it is").
			let extraStatus = 0
			let askedThisTurn = false
			const request = trigger.kind === 'message' ? trigger.text : ''
			const admit = (sentence: string, source: 'opener' | 'designer' | 'narration'): boolean => {
				if (/\?["')\]]*$/.test(sentence.trim())) {
					if (source === 'opener' || askedThisTurn) return false
					// Checked against the canvas when it is due to play (see vetQuestion).
					askedThisTurn = true
					return true
				}
				// "Let me check the canvas first" is filler: the acknowledgement already covered it.
				if (/^(one moment|just a (moment|sec)|let me (see|check|look|read)|checking|looking at)\b/i.test(sentence.trim())) return false
				if (statusCount >= statusCap + extraStatus) return false
				if (this.turnAudit && unsupportedClaim(sentence, this.turnAudit)) return false
				if (source === 'designer' && !review && namesUnaskedColor(sentence, request)) return false
				statusCount++
				return true
			}
			const openerLines: Promise<void>[] = []
			let openerDone: Promise<void> = Promise.resolve()
			if (trigger.kind === 'message' && this.provider.opener) {
				const afterAck = speech
				this.status('Thinking…')
				openerDone = this.provider
					.opener(this.history, `${trigger.from.name}: ${trigger.text}`, abort.signal, (sentence) => {
						if (!admit(sentence, 'opener')) return
						const line = this.prepareLine(sentence)
						openerLines.push(afterAck.then(() => (abort.signal.aborted ? undefined : this.say(sentence, driver!, { line }))))
					})
					.then((text) => {
						opener = text
						// The opener said nothing usable (its sentence described visuals, or it failed):
						// a plain status line so the turn still says what is happening.
						if (!text && !abort.signal.aborted && admit(fallbackStatus(trigger.text, this.hasScreens()), 'opener')) {
							const line = fallbackStatus(trigger.text, this.hasScreens())
							openerLines.push(afterAck.then(() => (abort.signal.aborted ? undefined : this.say(line, driver!, { line: this.prepareLine(line) }))))
						}
					})
					.catch((err) => {
						if (!abort.signal.aborted) console.warn('[agent] opener failed:', (err as Error).message)
					})
				const ackDone = speech
				speech = openerDone.then(() => (openerLines.length ? Promise.all(openerLines).then(() => undefined) : ackDone))
			}
			// A new screen: put a skeleton of it on the canvas right away (well under a second),
			// while the designer model writes the real one; its first create_screen replaces it.
			let skeleton: Promise<unknown> = Promise.resolve()
			if (trigger.kind === 'message' && !model && this.provider.name.startsWith('xai:') && isNewScreenRequest(trigger.text, this.hasScreens())) {
				skeletonPlaced = true
				skeleton = this.callClient(driver, 'create_skeleton', classifyScreenRequest(trigger.text), abort.signal)
			}
			this.status('Looking at the board…')
			const triggerMessage = await this.buildTriggerMessage(trigger, driver, abort.signal)
			const note = model
				? `(A spoken status line about this request is already playing. Make the tool calls first, with no status sentence of your own. Then end with ONE short question about the next meaningful product step: another screen in the flow, a missing state (empty, error, loading), a light/dark pair or a missing key component; never a small style or copy tweak, never something already true.)`
				: this.provider.opener && trigger.kind === 'message' && !isCritiqueRequest(trigger.text)
				? `(A spoken status line about this request is already playing ("${ack} ..."). Your text is only ONE short question about a specific element you are building; no status sentence, no description. Do all the building with tool calls (create_screen, add_nodes, focus_view), never as JSON in your text.)`
				: `(The user just heard you say "${ack}". Now speak your first short sentence while you work; don't repeat "${ack}".)`
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
				let tools: Promise<void> = step === 0 ? skeleton.then(() => undefined) : previous
				const results: { call: ToolCall; result: ToolResult }[] = []
				let toolError: unknown = null
				let firstSentence = true
				// The step's question plays once its tool calls have run, so it never asks about
				// something that isn't on the canvas yet.
				let toolsRan!: () => void
				const stepToolsDone = new Promise<void>((r) => (toolsRan = r))
				const { text, toolCalls } = await this.provider.complete(
					[{ role: 'system', content: SYSTEM_PROMPT }, ...this.history],
					ALL_TOOLS,
					abort.signal,
					{
						// Each sentence goes to the voice as soon as it streams in; they play in order,
						// after the previous step's speech.
						onSentence: (sentence) => {
							if (/^SILENT\b/.test(sentence) || isToolChatter(sentence)) return
							// The opener may already have said the same thing.
							if (step === 0 && firstSentence && opener && similar(sentence, opener)) {
								firstSentence = false
								debug(`skipped (repeats the opener): ${sentence.slice(0, 40)}`)
								return
							}
							firstSentence = false
							sentence = honestSpeech(sentence)
							if (!admit(sentence, 'designer')) {
								debug(`not spoken (over the line budget or unbacked): ${sentence.slice(0, 60)}`)
								return
							}
							debug(`sentence: ${sentence.slice(0, 40)}`)
							const line = this.prepareLine(sentence)
							if (/\?["')\]]*$/.test(sentence.trim())) {
								// The question plays once this step's tool calls ran, after a check against the
								// canvas: a copy tweak, something already true, or a repeat is swapped for the next
								// meaningful product step.
								lines.push(
									Promise.all([previous, stepToolsDone]).then(async () => {
										if (abort.signal.aborted) return
										const final = await this.vetQuestion(sentence, review, debug)
										if (!final || abort.signal.aborted) return
										this.askedQuestions = [...this.askedQuestions, final].slice(-8)
										return this.say(final, driver!, { line: final === sentence ? line : this.prepareLine(final) })
									})
								)
							} else lines.push(previous.then(() => (abort.signal.aborted ? undefined : this.say(sentence, driver!, { line }))))
						},
						onText: (t) => debug(`text done (${t.length} chars)${t.length > 200 ? `: ${t.slice(0, 400)}` : ''}`),
						onToolCall: (call) => {
							tools = tools.then(async () => {
								if (abort.signal.aborted) return
								driver = this.pickDriver(driver)
								if (!driver) throw new Error('No connected browser to design with.')
								this.status(`Running ${call.function.name}…`)
								results.push({ call, result: await this.executeTool(call, driver) })
							}).catch((err) => {
								toolError ??= err
							})
						},
					},
					model ? { model, conversationId: `${this.room.id}` } : { reasoningEffort: effort, conversationId: `${this.room.id}` }
				)
				debug(`stream done: ${toolCalls.length} tool call(s)`)
				// Safety net: if Grok drew without saying anything, narrate what appeared so the
				// voice never goes quiet while the board changes.
				if (!lines.length && toolCalls.length && !abort.signal.aborted) {
					const narration = narrateDrawing(toolCalls)
					if (narration && admit(narration, 'narration')) {
						debug(`narrating silent step: ${narration}`)
						const line = this.prepareLine(narration)
						lines.push(previous.then(() => (abort.signal.aborted ? undefined : this.say(narration, driver!, { line }))))
					}
				}
				await tools
				toolsRan()
				debug('tools done')
				if (toolError) throw toolError
				speech = lines.length ? Promise.all(lines).then(() => undefined) : previous
				if (abort.signal.aborted) break
				// An empty final reply (no text, no tools) is not a valid history entry for the API.
				if (text || toolCalls.length) {
					this.pushHistory({ role: 'assistant', content: text ?? '', ...(toolCalls.length ? { tool_calls: toolCalls } : {}) })
				}
				// The model sometimes writes a create_screen spec as JSON text instead of calling the tool:
				// nothing was built, so ask once for the real calls.
				const leaked = !!text && text.length > 300 && /\{\s*"(id|parentId|nodes|children)"\s*:/.test(text) && !toolCalls.some((c) => c.function.name === 'create_screen' || c.function.name === 'add_nodes')
				if (leaked && !nudged && trigger.kind === 'message') {
					nudged = true
					if (toolCalls.length) for (const call of toolCalls) this.pushHistory({ role: 'tool', tool_call_id: call.id, content: formatToolResult(results.find((r) => r.call.id === call.id)?.result ?? { ok: false, error: 'Not run.' }) })
					this.pushHistory({ role: 'user', content: '(Your reply put the design as JSON in its text, so nothing was built. Make those changes now as real tool calls (create_screen, add_nodes, focus_view), without speaking again.)' })
					continue
				}
				if (!toolCalls.length) {
					// A design request answered with words only (it happens at low reasoning effort):
					// nudge once to actually build it, without speaking again.
					if (step === 0 && !nudged && trigger.kind === 'message' && !model && /\b(design|build|create|make|add|sketch|draw)\b/i.test(trigger.text)) {
						nudged = true
						this.pushHistory({ role: 'user', content: '(Nothing is on the canvas yet. Build it now with tool calls, without speaking again.)' })
						continue
					}
					break
				}

				const images: ContentPart[] = []
				let clean = true
				for (const call of toolCalls) {
					const result = results.find((r) => r.call.id === call.id)?.result ?? { ok: false, error: 'Not run.' }
					// The scripted mock parses the canvas state, so it gets it whole; Grok gets it capped.
					this.pushHistory({ role: 'tool', tool_call_id: call.id, content: formatToolResult(result, this.provider.name === 'mock' ? Infinity : undefined) })
					if (!result.ok && call.function.name !== 'add_comment') extraStatus = 1
					if (result.image) images.push({ type: 'image_url', image_url: { url: result.image, detail: 'high' } })
					if (!result.ok || (result.data as any)?.warnings?.length || READING_TOOLS.has(call.function.name)) clean = false
				}
				// A build step is finished when it ends with focus_view (the prompt's order); a step of
				// small edits (no create_screen / add_nodes) is finished as it is.
				const names = toolCalls.map((c) => c.function.name)
				if (names.some((n) => n === 'create_screen' || n === 'add_nodes' || n === 'duplicate_screen') && !names.includes('focus_view')) clean = false
				// The model already asked its closing question and every call went through
				// cleanly: the turn is done, without another round trip to the model.
				const asked = !!text && /\?["')\]]*\s*$/.test(text.trim())
				if (asked && clean && !images.length) {
					debug('done: question asked and tools ran cleanly')
					break
				}
				if (asked && !clean) {
					this.pushHistory({ role: 'user', content: '(Tool results are above. You already asked your question this turn: fix any warnings or errors with tool calls and do not ask it again; if nothing needs fixing, reply with an empty message.)' })
				}
				// Tool messages can't carry images in this API, so attach them as a follow-up user message.
				if (images.length) {
					this.pushHistory({ role: 'user', content: [{ type: 'text', text: 'Canvas image(s) you requested:' }, ...images] })
				}
			}
			// A critique covers every screen the audit found problems on: a screen the model
			// skipped gets a note made from the measurement itself (true by construction).
			if (review && this.turnAudit?.length && !abort.signal.aborted) {
				driver = this.pickDriver(driver)
				if (driver) await this.coverAuditedScreens(driver, trigger.kind === 'message' || trigger.kind === 'check_work' ? trigger.from.name : '', abort.signal)
			}
			// A design turn that changed the canvas but never asked: one question about the next step.
			if (!review && !askedThisTurn && trigger.kind === 'message' && this.turnChanged && !abort.signal.aborted && driver) {
				const q = nextStepQuestion(this.canvasFacts(), this.askedQuestions)
				if (q) {
					askedThisTurn = true
					this.askedQuestions = [...this.askedQuestions, q].slice(-8)
					const d = driver
					const line = this.prepareLine(q)
					speech = speech.then(() => (abort.signal.aborted ? undefined : this.say(q, d, { line })))
				}
			}
			await speech
		} catch (err: any) {
			if (!abort.signal.aborted) {
				console.error('[agent]', err)
				this.broadcast({ type: 'error', message: err?.message ?? String(err) })
			}
		} finally {
			// A skeleton the turn never replaced (an error, or the model rebuilt another screen) goes away.
			const d = skeletonPlaced ? this.pickDriver(driver) : null
			if (d) await this.callClient(d, 'remove_skeleton', {})
			this.turnAudit = null
			this.turnChanged = false
			this.abort = null
			this.busy = false
			this.status('')
			this.broadcastState()
			const next = this.queued
			this.queued = null
			if (next) void this.runTurn(next)
		}
	}

	private hasScreens() {
		for (const s of this.room.shapes.values()) if ((s as any).type === 'ui' && (s as any).props?.kind === 'screen') return true
		return false
	}

	/**
	 * Builds the user message that starts a turn. For reviews, the canvas context
	 * (structured state, recent changes, and an image when there is freehand ink)
	 * is gathered up front so the model can respond without extra round trips.
	 */
	private async buildTriggerMessage(t: Trigger, driver: Client, signal: AbortSignal): Promise<ChatMessage> {
		const others = [...this.clients.values()].map((c) => c.name).join(', ')
		const header = `Mode: ${this.mode}. Collaborators in the room: ${others || 'none'}.`
		if (t.kind === 'message') {
			const changes = this.takeRecentChanges()
			const sel = t.selection.length ? `\n${t.from.name} has selected: ${t.selection.map(stripId).join(', ')}.` : ''
			const ch = changes.total ? `\nCollaborator edits since you last looked: ${JSON.stringify(changes.byUser)}` : ''
			const asked = this.askedQuestions.length ? `\n(Questions you already asked in earlier turns; never ask them again: ${this.askedQuestions.map((q) => `"${q}"`).join(' ')})` : ''
			let review = ''
			if (isCritiqueRequest(t.text) && this.hasScreens()) {
				// A spoken "what do you think?" gets the same measured facts as the Critique button.
				const state = await this.callClient(driver, 'get_canvas_state', { audit: true }, signal)
				const audit: AuditIssue[] = (state.data as any)?.audit ?? []
				this.turnAudit = audit
				review = `\nCanvas state: ${formatToolResult(state)}\n${auditNote(audit)}`
			}
			return { role: 'user', content: `[trigger:message] ${header}${sel}${ch}${asked}${review}\n${t.from.name} says: ${t.text}` }
		}

		const scope = t.kind === 'check_work' && t.shapeIds.length ? { shapeIds: t.shapeIds.map(stripId) } : {}
		const state = await this.callClient(driver, 'get_canvas_state', { ...scope, audit: true }, signal)
		const audit: AuditIssue[] = (state.data as any)?.audit ?? []
		this.turnAudit = audit
		const changes = this.takeRecentChanges()
		const parts: ContentPart[] = []
		const intro =
			t.kind === 'check_work'
				? `[trigger:check_work] ${header}\n${t.from.name} pressed "Critique"${
						t.shapeIds.length ? ' with a selection (critique only those nodes)' : ''
					}. Critique their design and give feedback by voice AND on the canvas: point at the specific nodes you are talking about with highlight_shapes and add_comment (kinds issue, suggestion, praise), and offer concrete fixes you can apply with update_node.`
				: `[trigger:idle] ${header}\nThe collaborators paused after editing the canvas. Decide whether to comment (proactive mode).`
		parts.push({
			type: 'text',
			text: `${intro}\nCanvas state: ${formatToolResult(state)}\nRecent collaborator edits: ${JSON.stringify(changes.byUser)}\n${auditNote(audit)}`,
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
		const turnId = this.turnId || undefined
		this.broadcast({ type: 'agent_say', sayId, text, report: false, audioUrl, ephemeral, turnId }, driver.ws)
		this.send(driver.ws, { type: 'agent_say', sayId, text, report: true, audioUrl, ephemeral, turnId })
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

		// "Switch everything to dark mode": the theme goes on every screen, even if the model named one.
		if (name === 'set_theme' && args.screenId && args.screenId !== 'all' && /\b(everything|every screen|all( the| of the)? screens|all of (it|them)|whole (app|canvas|file|flow)|across the board)\b/i.test(this.turnRequest)) {
			args = { ...args, screenId: 'all' }
		}
		// A critique leaves 3-5 notes: the most important ones.
		if (name === 'add_comment' && this.turnAudit && this.turnComments.length >= 5) {
			return { ok: false, error: 'This critique already has 5 notes; keep to those (no more add_comment).' }
		}
		const confirm = this.guard(name, args)
		if (process.env.AGENT_DEBUG) console.log(`[agent] ${name} (${call.function.arguments.length} chars) ${JSON.stringify(args).slice(0, 300)}${confirm ? ' (needs confirmation)' : ''}`)
		const result = await this.callClient(driver, name, args, this.abort?.signal, confirm)
		if (process.env.AGENT_DEBUG && (!result.ok || (result.data as any)?.warnings)) console.log(`[agent] ${name} -> ${result.ok ? JSON.stringify((result.data as any).warnings) : result.error}`)
		if (result.ok && CHANGING_TOOLS.has(name)) this.turnChanged = true
		if (name === 'add_comment' && result.ok) this.turnComments.push(this.screenOf(String(args.targetShapeId ?? '')) ?? '')
		if (name === 'focus_view' && result.ok && args.scope === 'everyone') {
			this.broadcast({ type: 'focus', shapeIds: args.shapeIds ?? [], zoomLevel: args.zoomLevel }, driver.ws)
		}
		return result
	}

	/** The screen (top-level ui shape) a node belongs to, from the server's copy of the shapes. */
	private screenOf(id: string): string | null {
		let cur = this.room.shapes.get(id.startsWith('shape:') ? id : `shape:${id}`) as any
		let screen: string | null = null
		for (let i = 0; cur && i < 50; i++) {
			if (cur.type === 'ui' && cur.props?.kind === 'screen') screen = stripId(cur.id)
			cur = this.room.shapes.get(cur.parentId)
		}
		return screen
	}

	/** What the server knows about the canvas: screens with their theme (for vetting questions). */
	canvasFacts(): CanvasFacts {
		const screens: CanvasFacts['screens'] = []
		for (const s of this.room.shapes.values() as Iterable<any>) {
			if (s.type !== 'ui' || s.props?.kind !== 'screen' || s.meta?.skeleton || !String(s.parentId).startsWith('page:')) continue
			screens.push({ id: stripId(s.id), name: String(s.props.name || stripId(s.id)), x: s.x, mode: s.meta?.theme?.mode === 'dark' ? 'dark' : 'light', primary: String(s.meta?.theme?.primary ?? '') })
		}
		screens.sort((a, b) => a.x - b.x)
		return { screens }
	}

	/**
	 * The steering question that actually plays: the model's, unless it is a copy or
	 * number tweak, asks for something already true on the canvas, or repeats an earlier
	 * one; then the next meaningful product step (another screen in the flow, a state, a
	 * light/dark pair). Critique offers ("Want me to fix...?") are only deduped.
	 */
	private async vetQuestion(question: string, review: boolean, debug: (m: string) => void): Promise<string | null> {
		const repeat = this.askedQuestions.some((q) => sameQuestion(question, q))
		if (review) return repeat ? null : question
		// Give the canvas sync a moment to deliver the step's last edits to the server's copy.
		await new Promise((r) => setTimeout(r, 150))
		const facts = this.canvasFacts()
		const problem = repeat ? 'repeats an earlier question' : questionProblem(question, facts)
		if (!problem) return question
		const next = nextStepQuestion(facts, [...this.askedQuestions, question])
		debug(`question replaced (${problem}): "${question}" -> ${next ? `"${next}"` : 'nothing'}`)
		if (process.env.AGENT_DEBUG) console.log(`[agent] question replaced (${problem}): "${question}" -> "${next}"`)
		return next
	}

	/** Critique fallback: one note per audited screen the model left without one (at most 5 notes in all). */
	private async coverAuditedScreens(driver: Client, to: string, signal: AbortSignal) {
		const byScreen = new Map<string, AuditIssue>()
		const rank: Record<string, number> = { overflow: 0, clipped: 1, contrast: 2, touch: 3, small_text: 4, spacing: 5 }
		for (const i of this.turnAudit ?? []) {
			if (!i.say) continue
			const cur = byScreen.get(i.screen)
			if (!cur || rank[i.kind] < rank[cur.kind]) byScreen.set(i.screen, i)
		}
		for (const [screen, issue] of byScreen) {
			if (this.turnComments.includes(screen) || this.turnComments.length >= 5 || signal.aborted) continue
			const hl = await this.callClient(driver, 'highlight_shapes', { id: `hl_audit_${screen}`, shapeIds: [issue.id], color: 'red' }, signal)
			const res = await this.callClient(driver, 'add_comment', { id: `c_audit_${screen}`, kind: 'issue', text: issue.say, targetShapeId: issue.id, ...(to ? { addressedTo: to } : {}) }, signal)
			if (res.ok) this.turnComments.push(screen)
			if (process.env.AGENT_DEBUG) console.log(`[agent] audit note on ${screen}: ${issue.say} (${hl.ok && res.ok ? 'ok' : res.error})`)
		}
	}

	/**
	 * Server-side enforcement of "respect user work": any call that would
	 * change or remove a user-authored node needs a collaborator's explicit OK.
	 */
	guard(name: string, args: Record<string, any>): { message: string } | undefined {
		const userOwned = (ids: string[]) =>
			ids.filter((id) => this.room.getAuthor(id)?.kind === 'user').map((id) => ({ id, author: this.room.getAuthor(id)! }))
		let touched: { id: string; author: Author }[] = []
		let verb = 'change'
		if (['update_node', 'move_node', 'create_screen', 'duplicate_screen'].includes(name)) {
			touched = userOwned([String(args.id ?? '')])
		} else if (name === 'add_nodes') {
			touched = userOwned([String(args.parentId ?? '')])
		} else if (name === 'set_theme') {
			if (args.screenId && args.screenId !== 'all') touched = userOwned([String(args.screenId)])
		} else if (name === 'delete_nodes') {
			verb = 'delete'
			touched = userOwned((args.ids ?? []).map((id: string) => stripId(String(id))))
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
			message: `Grok Design wants to ${verb} ${touched.length} element(s) designed by ${owners}. Allow?`,
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

/**
 * A request that tweaks what is already on the canvas (colors, spacing, text,
 * theme, adding a control) rather than designing a new screen or rebuilding one.
 */
export function isQuickEdit(text: string, hasScreens: boolean): boolean {
	if (!hasScreens) return false
	const t = text.toLowerCase()
	if (/\b(redo|rebuild|redesign|rethink|from scratch|critique|review|feedback|what do you think)\b/.test(t)) return false
	const screenish = /\b(screens?|pages?|dashboards?|landing|onboarding|flows?|apps?|website|site|views?|checkout|profile|settings|login|sign ?up|home ?screen)\b/.test(t)
	const building = /\b(design|build|create|make|add|sketch|draw|another|new|generate)\b/.test(t)
	return !(screenish && building && !/\b(to|on|in) the\b/.test(t))
}

/** The measured-issues paragraph a critique turn starts with. */
export function auditNote(audit: AuditIssue[]): string {
	return audit.length
		? `MEASURED ISSUES (from real bounds and rendered colors; "audit" in the state): ${audit.map((i) => `[${i.kind}] ${i.detail} (screen ${i.screen})`).join('; ')}. These are the ONLY overflow, clipping, overlap, contrast, tap-target, text-size or alignment problems that exist: never claim one that is not listed. Each of these screens gets an issue note on its listed node: ${[...new Set(audit.map((i) => i.screen))].join(', ')}.`
		: `MEASURED ISSUES: none. Every node fits inside its frame and screen, no text is clipped, text contrast passes 4.5:1, phone tap targets are 44px+, no text is under 12px, card rows share heights. So never claim overflow, clipping, overlap, contrast, tap-target, text-size or alignment problems: critique hierarchy, copy, content, density and flow instead.`
}

const COLOR_WORDS = /\b(navy|teal|sage|emerald|indigo|violet|purple|blue|green|red|orange|yellow|pink|brown|gold|golden|black|white|gr[ae]y|pastel|neon|gradient|lavender|mint|coral|beige|cream|charcoal|slate|amber|crimson|maroon|olive|turquoise|cyan|magenta|peach|ivory)\b/gi

/** True when a sentence names a color the request didn't (spoken before the tool calls, so it can't be checked against the canvas). */
export function namesUnaskedColor(sentence: string, request: string): boolean {
	const asked = request.toLowerCase()
	return (sentence.match(COLOR_WORDS) ?? []).some((w) => !asked.includes(w.toLowerCase()))
}

/** A request for a new screen (not an edit, rebuild or critique): it gets an instant skeleton. */
export function isNewScreenRequest(text: string, hasScreens: boolean): boolean {
	if (isQuickEdit(text, hasScreens) || isCritiqueRequest(text)) return false
	const t = text.toLowerCase()
	if (/\b(redo|rebuild|redesign|rethink|replace|from scratch|update|change|tweak)\b/.test(t)) return false
	return /\b(design|build|create|make|add|sketch|draw|generate|mock ?up|wireframe)\b/.test(t) && /\b(screens?|pages?|dashboards?|landing|onboarding|apps?|website|site|views?|checkout|profile|settings|log ?in|sign ?up|home ?screen)\b/.test(t)
}

/** A plain status line for a turn whose opener said nothing ("Okay, working on the dashboard."). */
export function fallbackStatus(text: string, hasScreens: boolean): string {
	if (!isNewScreenRequest(text, hasScreens)) return 'On it.'
	const { kind } = classifyScreenRequest(text)
	const noun = kind === 'list' ? 'new screen' : kind === 'dashboard' ? 'dashboard' : kind === 'landing' ? 'landing page' : `${kind === 'login' ? 'log-in' : kind} screen`
	return `Okay, working on the ${noun} now.`
}

const QUESTION_STOP = new Set(['want', 'should', 'would', 'like', 'more', 'less', 'with', 'under', 'above', 'below', 'next', 'instead', 'keep', 'make', 'that', 'this', 'there', 'them', 'they', 'from', 'into', 'your', 'have', 'just', 'also', 'stay', 'every', 'each'])

/** True when two steering questions ask about the same thing (content words mostly shared). */
export function sameQuestion(a: string, b: string): boolean {
	const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !QUESTION_STOP.has(w)))
	const x = words(a)
	const y = words(b)
	if (!x.size || !y.size) return false
	let shared = 0
	for (const w of x) if (y.has(w)) shared++
	return shared / Math.min(x.size, y.size) >= 0.75
}

/** "What do you think?", "critique the dashboard", "any feedback?" */
export function isCritiqueRequest(text: string): boolean {
	return /\b(critique|review|feedback|what do you think|how does (it|this) look|thoughts on)\b/i.test(text)
}

/** Drops claims the canvas can't back up ("a live chart", "real-time updates"): designs are static. */
export function honestSpeech(sentence: string): string {
	return sentence.replace(/\b(live|real-time|realtime|animated|interactive)\s+(?=[a-z])/gi, '').replace(/\s+that updates? (every|in) (real[- ]?time|(a |one )?(second|minute|day)s?)/gi, '')
}

/** Tools that change the design (a turn that ran one gets a steering question). */
const CHANGING_TOOLS = new Set(['create_screen', 'add_nodes', 'update_node', 'move_node', 'delete_nodes', 'duplicate_screen', 'set_theme', 'connect_screens'])

export type CanvasFacts = { screens: { id: string; name: string; x: number; mode: 'light' | 'dark'; primary: string }[] }

const COLOR_FAMILIES: Record<string, string> = {
	green: 'green', emerald: 'green', mint: 'green', sage: 'green', olive: 'green', lime: 'green', forest: 'green',
	teal: 'teal', turquoise: 'teal', cyan: 'teal', aqua: 'teal',
	blue: 'blue', navy: 'blue', sky: 'blue', cobalt: 'blue', azure: 'blue',
	indigo: 'purple', violet: 'purple', purple: 'purple', lavender: 'purple', plum: 'purple',
	pink: 'pink', magenta: 'pink', rose: 'pink', fuchsia: 'pink',
	red: 'red', crimson: 'red', maroon: 'red', coral: 'orange', orange: 'orange', amber: 'orange', peach: 'orange',
	yellow: 'yellow', gold: 'yellow', golden: 'yellow', brown: 'brown', coffee: 'brown', chocolate: 'brown', tan: 'brown',
}

/** Color family of a hex brand color ("#16a34a" -> green). */
export function colorFamily(hex: string): string | null {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
	if (!m) return null
	const n = parseInt(m[1], 16)
	const [r, g, b] = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const l = (max + min) / 2
	if (max - min < 0.08) return null
	const d = max - min
	let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
	h = (h * 60 + 360) % 360
	if (h >= 15 && h < 45 && l < 0.4) return 'brown'
	if (h < 15 || h >= 345) return 'red'
	if (h < 45) return 'orange'
	if (h < 70) return 'yellow'
	if (h < 165) return 'green'
	if (h < 195) return 'teal'
	if (h < 250) return 'blue'
	if (h < 290) return 'purple'
	return 'pink'
}

/**
 * Why a steering question isn't worth asking, or null when it is: a copy or number
 * tweak ("headline to read X instead of Y", "set for 7:00 AM", "eight months or twelve")
 * or something already true on the canvas ("stay highlighted in the new green", a color
 * the brand already is, a mode every screen is already in).
 */
export function questionProblem(question: string, facts: CanvasFacts): string | null {
	const q = question.toLowerCase()
	if (/["“”]/.test(question) || /\b(read|reads|say|says|wording|reword|rename|retitle|relabel)\b/.test(q)) return 'copy tweak'
	if (/\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b\d{1,2}:\d{2}\b/.test(q)) return 'time tweak'
	if (/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(months?|weeks?|days?|years?|quarters?)\b/.test(q)) return 'range tweak'
	if (/\b(stay|stays|keep|keeps|remain|remains)\b|\bstill (be|look|use|show|read|feel|highlight|work)/.test(q)) return 'asks to keep what is already there'
	// Restyling one element ("the chart switched to line?", "the header in uppercase?") is a tweak, not a product step.
	if (/\b(switch(ed)? (it |them )?to|in (uppercase|lowercase|bold|italics?)|bolder|bigger|smaller|larger|rounder|thicker|thinner|lighter|darker|softer|warmer|cooler|brighter|muted|font|shade|tint|padding|spacing|aligned|alignment|corner radius|radius)\b/.test(q) && !/\b(screen|page|state|flow|version|copy of|mode)\b/.test(q)) return 'style tweak'
	const screens = facts.screens
	// "...for the login screen" must be about a screen that exists.
	const named = /\b(?:for|on|in|of|to) the ([a-z-]+(?: [a-z-]+)?) (?:screen|page)\b/.exec(q)?.[1]
	if (named && screens.length) {
		const words = named.replace(/-/g, ' ').split(' ').filter((w) => w.length > 2)
		const exists = screens.some((s) => {
			const n = `${s.name} ${s.id}`.toLowerCase().replace(/[-_]/g, ' ')
			return words.some((w) => n.includes(w.replace(/s$/, '')) || (w === 'login' && /log ?in|sign ?in/.test(n)))
		})
		if (!exists) return `names a ${named} screen that isn't on the canvas`
	}
	if (screens.length) {
		const families = new Set(screens.map((s) => colorFamily(s.primary)).filter(Boolean))
		for (const w of q.match(/\b[a-z]+\b/g) ?? []) {
			const fam = COLOR_FAMILIES[w]
			if (fam && families.has(fam)) return `the brand is already ${w}`
		}
		if (/\bdark\b/.test(q) && !/\blight\b/.test(q) && screens.every((s) => s.mode === 'dark')) return 'already dark'
		if (/\blight (mode|theme)\b/.test(q) && !/\bdark\b/.test(q) && screens.every((s) => s.mode === 'light')) return 'already light'
	}
	return null
}

const NEXT_STEPS: Record<string, string[]> = {
	login: ['Want a sign-up screen next, linked from the create-account link?', 'Want an error state for a wrong password on the log-in screen?'],
	onboarding: ['Want the sign-up screen that Continue leads to, linked up?', 'Want the next onboarding step, with its own artwork and copy?'],
	settings: ['Want an edit-profile screen, linked from the profile card?', 'Want a confirmation sheet for Log out?'],
	dashboard: ['Want an empty state for the dashboard, before any transactions come in?', 'Want a transaction detail screen, linked from the table?', 'Want a loading state for the dashboard cards?'],
	landing: ['Want a pricing page, linked from the nav?', 'Want a sign-up page for the main call to action?'],
	list: ['Want a detail screen for the first item, linked from its row?', 'Want an empty state for when the list has nothing in it yet?'],
}

/** The next meaningful product step to offer: another screen in the flow, a state, or a light/dark pair, never one already asked or built. */
export function nextStepQuestion(facts: CanvasFacts, asked: string[]): string | null {
	const screens = [...facts.screens].sort((a, b) => b.x - a.x)
	if (!screens.length) return null
	const names = screens.map((s) => s.name.toLowerCase()).join(' | ')
	const built = (q: string) =>
		(/sign-up/.test(q) && /sign ?-?up|register|create account/.test(names)) ||
		(/pricing/.test(q) && /pricing/.test(names)) ||
		(/edit-profile/.test(q) && /profile/.test(names)) ||
		(/detail screen/.test(q) && /detail/.test(names)) ||
		(/empty state/.test(q) && /empty/.test(names)) ||
		(/onboarding step/.test(q) && screens.filter((s) => /onboarding|welcome/.test(s.name.toLowerCase())).length > 1)
	const candidates: string[] = []
	const kindOf = (name: string) => classifyScreenRequest(name).kind
	const latest = screens[0]
	candidates.push(...(NEXT_STEPS[kindOf(latest.name)] ?? []))
	const label = latest.name.length <= 24 ? latest.name : 'latest screen'
	if (screens.every((s) => s.mode === 'dark')) candidates.push(`Want a light version of the ${label} beside it, to compare?`)
	else if (screens.every((s) => s.mode === 'light')) candidates.push(`Want a dark-mode copy of the ${label} beside it, to compare?`)
	for (const s of screens.slice(1)) candidates.push(...(NEXT_STEPS[kindOf(s.name)] ?? []))
	return candidates.find((c) => !built(c) && !asked.some((a) => sameQuestion(a, c))) ?? null
}

/** Tools that only read: the model needs another step to use what they return. */
const READING_TOOLS = new Set(['get_canvas_state', 'get_canvas_image', 'get_recent_changes', 'get_participants'])

/** Rough "says the same thing" check (word overlap) between a sentence and what was already spoken. */
export function similar(a: string, b: string): boolean {
	const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3))
	const x = words(a)
	const y = words(b)
	if (!x.size) return false
	let shared = 0
	for (const w of x) if (y.has(w)) shared++
	return shared / x.size >= 0.6
}

/** Tool-call chatter the model sometimes leaks into its text ("55.0 is not a valid tool."): never speak it. */
export function isToolChatter(sentence: string): boolean {
	return /\b(not a valid tool|tool_calls?|function call|invalid arguments?)\b|^[{[]|"\w+"\s*:/i.test(sentence)
}

/** A short spoken line describing what a silent design step added ("Here's the Login screen."). */
export function narrateDrawing(calls: ToolCall[]): string | null {
	const labels: string[] = []
	for (const c of calls) {
		let args: any
		try {
			args = JSON.parse(c.function.arguments || '{}')
		} catch {
			continue
		}
		const name = typeof args.name === 'string' ? args.name.trim() : ''
		if (c.function.name === 'create_screen' && name && name.length <= 30) labels.push(`the ${name} screen`)
		else if (c.function.name === 'create_screen') labels.push('a new screen')
		else if (c.function.name === 'duplicate_screen') labels.push('a copy of the screen')
	}
	const unique = [...new Set(labels)].slice(0, 3)
	if (!unique.length) return null
	const list = unique.length === 1 ? unique[0] : `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`
	return `Here's ${list}.`
}

function formatToolResult(r: ToolResult, limit = 40_000): string {
	const body = r.ok
		? { ok: true, ...(r.data && typeof r.data === 'object' ? r.data : { result: r.data ?? 'done' }), ...(r.image ? { image: 'attached below' } : {}) }
		: { ok: false, error: r.error }
	const s = JSON.stringify(body)
	return s.length > limit ? `${s.slice(0, limit)}…(truncated)` : s
}
