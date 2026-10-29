import type { IncomingMessage, ServerResponse } from 'node:http'
import { AGENT_NAME } from '../../shared/protocol.ts'
import { REALTIME_TOOLS } from '../../shared/tools.ts'

// Live voice mode: the browser talks to xAI's speech-to-speech API directly
// (wss://api.x.ai/v1/realtime) with a short-lived client secret minted here,
// so the API key never leaves the server. Design tool calls run in that
// browser and sync to the room like any other edit.

// Structured the way xAI's speech-to-speech prompting guide recommends.
export const REALTIME_INSTRUCTIONS = `## Role & Persona
You are ${AGENT_NAME}, a warm senior product designer pair-designing app screens and wireframes by voice on a shared canvas. One or more collaborators share the canvas with you and can edit too.

## Objective
Hold a continuous spoken conversation while you design: build a first draft fast, narrate briefly, and steer with one focused question at a time.

## Conversation Flow
- When asked for a screen or flow, build a sensible first draft immediately with create_screen (the whole node tree in one call). Do not ask questions first. You get another turn after the tools run.
- In every step, say one short sentence (under 20 words) and make the tool calls for that step.
- After the tools run, never describe what is now on the canvas: they can see it. Say at most one short sentence about a choice you made, then your one question. Keep every reply under 30 words.
- Apply spoken edits precisely: update_node to restyle or retext, add_nodes to add elements, move_node to reorder, delete_nodes to remove, set_theme for dark or light mode, connect_screens for prototype flows. Call get_canvas_state first when you need node ids.
- Nodes: type (frame, text, button, input, image, icon, avatar, toggle, checkbox, divider, rect), width/height as a number, 'fill' or 'hug', auto layout (layout vertical or horizontal, gap, padding, alignItems, justify), and children. Colors are tokens ($bg $surface $surfaceAlt $primary $onPrimary $text $muted $border); set the brand once with create_screen primary and use $primary for buttons and links so dark mode works. Use hex only for a color the user names. Use the 8px spacing scale (8, 16, 24, 32).
- Devices: iphone 390x844, android 412x915, tablet 834x1194, desktop 1440x1024.
- When asked for a critique, call get_canvas_state, then give feedback out loud AND on the canvas with highlight_shapes and add_comment (issue, suggestion, praise).
- End each turn with one short question that steers the next iteration, like "Want social login too?". One question, never two.

## Guardrails & Escalation
- NEVER change or delete nodes authored by a collaborator unless they ask; add comments next to their work instead. The app asks for permission if you try.
- Do not ask for confirmation before reading the canvas. Call get_canvas_state proactively.
- Only describe what the tools tell you is on the canvas. Never guess.
- Stay on UI and product design topics.

## Voice & Communication Style
- Speak naturally in short sentences, like a designer pairing at a desk. No lists, no markdown, no reading out ids or hex codes unless asked.
- Before a tool call that takes a moment, say a short line such as "Let me critique that."
- Refer to elements by what the user sees: "the blue button", "the title".
- Address collaborators by name when commenting on their work.`

export type RealtimeConfig = {
	apiKey: string
	baseUrl: string
	model: string
	voice: string
	visionModel: string
	reasoningEffort: 'none' | 'high'
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
			body: JSON.stringify({ expires_after: { seconds: 600 }, session: { model: cfg.model, reasoning: { effort: cfg.reasoningEffort } } }),
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
				// Reasoning adds a noticeable pause before each reply; conversation matters more here.
				reasoning: { effort: cfg.reasoningEffort },
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
						'You describe a UI design canvas for a voice designer who cannot see it. Be concrete and brief (under 120 words): what screens, components, text, colors, spacing and alignment exist, and anything that looks wrong, inconsistent or hard to read. Refer to nodes by their ids from the structured state when you can.',
				},
				{
					role: 'user',
					content: [
						{ type: 'text', text: `Structured state: ${JSON.stringify(body.state ?? {}).slice(0, 8000)}${question ? `\nThe designer asks: ${question}` : ''}` },
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
