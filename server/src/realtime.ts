import type { IncomingMessage, ServerResponse } from 'node:http'
import { AGENT_NAME } from '../../shared/protocol.ts'
import { REALTIME_TOOLS } from '../../shared/tools.ts'

// Live voice mode: the browser talks to xAI's speech-to-speech API directly
// (wss://api.x.ai/v1/realtime) with a short-lived client secret minted here,
// so the API key never leaves the server. Drawing tool calls run in that
// browser and sync to the room like any other edit.

// Structured the way xAI's speech-to-speech prompting guide recommends.
export const REALTIME_INSTRUCTIONS = `## Role & Persona
You are ${AGENT_NAME}, a warm, expert technical teacher at a shared whiteboard. You teach system design, data structures and algorithms, and other technical concepts. One or more students share the board with you and can draw too.

## Objective
Explain concepts by talking AND drawing at the same time, and check the work students draw.

## Conversation Flow
- When a student asks about a topic, explain it in small steps. In every step, say one or two short sentences and call the drawing tools for that step (create_shape, create_arrow, draw_array, update_shape). You get another turn after the tools run, so keep going step by step.
- Lay shapes out left to right with gaps of about 80 pixels; boxes are about 160 by 80. Tool results report final positions.
- For arrays and two-pointer problems, use draw_array and call it again with the same id to move pointers each iteration.
- When a student asks you to check their work, or says they drew something, call get_canvas_state first. If any shapes are freehand ("draw" type) or unlabeled, call look_at_board to see the drawing. Then give feedback out loud AND on the board with highlight_shapes, add_comment, or suggest_correction.
- End explanations with a short question that invites the student to try something.

## Guardrails & Escalation
- NEVER change or erase shapes drawn by a student unless they ask; annotate next to their work instead. The app asks the student for permission if you try.
- Do not ask for confirmation before reading the board. Call get_canvas_state and look_at_board proactively.
- Only describe what the tools tell you is on the board. Never guess.
- Stay on technical teaching topics.

## Voice & Communication Style
- Speak naturally in short sentences, like a teacher at a whiteboard. Talk about what is appearing on the board as you draw it.
- Before a tool call that takes a moment, say a short line such as "Let me take a look."
- Prefer a hint or a guiding question before giving the full answer. Praise what is right before pointing out what is wrong.
- Address students by name when commenting on their work.`

export type RealtimeConfig = {
	apiKey: string
	baseUrl: string
	model: string
	voice: string
	visionModel: string
	/** Overrides the WebSocket URL (used with a local fake server in tests). */
	urlOverride?: string
}

export async function createRealtimeSession(cfg: RealtimeConfig, res: ServerResponse) {
	let token = 'local-test-token'
	let expiresAt = Math.floor(Date.now() / 1000) + 600
	if (!cfg.urlOverride) {
		const r = await fetch(`${cfg.baseUrl}/realtime/client_secrets`, {
			method: 'POST',
			signal: AbortSignal.timeout(15_000),
			headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
			body: JSON.stringify({ expires_after: { seconds: 600 }, session: { model: cfg.model } }),
		})
		if (!r.ok) {
			return res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `client_secrets ${r.status}: ${(await r.text()).slice(0, 300)}` }))
		}
		const json: any = await r.json()
		token = json.value
		expiresAt = json.expires_at
	}
	const wsBase = cfg.baseUrl.replace(/^http/, 'ws')
	res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(
		JSON.stringify({
			url: cfg.urlOverride ?? `${wsBase}/realtime?model=${encodeURIComponent(cfg.model)}`,
			token,
			expiresAt,
			session: {
				instructions: REALTIME_INSTRUCTIONS,
				voice: cfg.voice,
				turn_detection: { type: 'server_vad' },
				audio: {
					input: { format: { type: 'audio/pcm', rate: 24000 } },
					output: { format: { type: 'audio/pcm', rate: 24000 } },
				},
				tools: REALTIME_TOOLS.map((t) => ({ type: 'function', ...t })),
			},
		})
	)
}

async function readJson(req: IncomingMessage, limit: number): Promise<any> {
	const chunks: Buffer[] = []
	let size = 0
	for await (const chunk of req) {
		size += chunk.length
		if (size > limit) throw Object.assign(new Error('too large'), { status: 413 })
		chunks.push(chunk)
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * The speech-to-speech model can't take images, so look_at_board sends the
 * board snapshot here and a vision-capable Grok model describes it.
 */
export async function describeBoard(cfg: RealtimeConfig, req: IncomingMessage, res: ServerResponse) {
	let body: { image?: string; state?: unknown; question?: string }
	try {
		body = await readJson(req, 12 * 1024 * 1024)
	} catch (err: any) {
		return res.writeHead(err.status ?? 400).end()
	}
	if (!body.image?.startsWith('data:image/')) return res.writeHead(400).end('image must be a data URL')
	const question = String(body.question ?? '').slice(0, 500)
	const r = await fetch(`${cfg.baseUrl}/chat/completions`, {
		method: 'POST',
		signal: AbortSignal.timeout(60_000),
		headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
		body: JSON.stringify({
			model: cfg.visionModel,
			messages: [
				{
					role: 'system',
					content:
						'You describe a whiteboard for a voice tutor who cannot see it. Be concrete and brief (under 120 words): what shapes, labels, arrows and connections exist, including hand-drawn ink, and anything that looks wrong or missing. Refer to shapes by their ids from the structured state when you can.',
				},
				{
					role: 'user',
					content: [
						{ type: 'text', text: `Structured state: ${JSON.stringify(body.state ?? {}).slice(0, 8000)}${question ? `\nThe tutor asks: ${question}` : ''}` },
						{ type: 'image_url', image_url: { url: body.image, detail: 'high' } },
					],
				},
			],
		}),
	})
	if (!r.ok) {
		return res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `vision ${r.status}` }))
	}
	const json: any = await r.json()
	res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ description: json.choices?.[0]?.message?.content ?? '' }))
}
