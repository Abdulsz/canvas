import type { ToolDef } from '../../shared/tools.ts'
import { StreamAssembler, type ChatMessage, type Completion, type LLMProvider, type StreamHandlers, type ToolCall } from './llm.ts'

// A scripted stand-in for Grok, used when no XAI_API_KEY is set (local
// development, demos, and end-to-end tests). It exercises the same tool
// pipeline as the real model: drawing, reading the board, and annotating.

let n = 0
const call = (name: string, args: object): ToolCall => ({
	id: `mock_${++n}`,
	type: 'function',
	function: { name, arguments: JSON.stringify(args) },
})

function textOf(m: ChatMessage): string {
	if (typeof m.content === 'string') return m.content
	if (Array.isArray(m.content)) return m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
	return ''
}

export class MockProvider implements LLMProvider {
	readonly name = 'mock'

	async complete(messages: ChatMessage[], _tools: ToolDef[], _signal: AbortSignal, handlers?: StreamHandlers): Promise<Completion> {
		// Replay the scripted reply through the same assembler the real provider uses.
		const { text, toolCalls } = this.script(messages)
		const assembler = new StreamAssembler(handlers)
		if (text) assembler.push({ content: text })
		toolCalls.forEach((c, index) => assembler.push({ tool_calls: [{ index, id: c.id, function: c.function }] }))
		return assembler.finish()
	}

	private script(messages: ChatMessage[]): Completion {
		// Find the message that started this turn and how many steps we've taken since.
		let start = messages.length - 1
		while (start >= 0 && !(messages[start].role === 'user' && textOf(messages[start]).startsWith('[trigger:'))) start--
		const trigger = start >= 0 ? textOf(messages[start]) : ''
		const step = messages.slice(start + 1).filter((m) => m.role === 'assistant').length
		const lastTool = [...messages].reverse().find((m) => m.role === 'tool')

		if (trigger.startsWith('[trigger:check_work]') || trigger.startsWith('[trigger:idle]')) {
			return this.review(trigger, step, lastTool)
		}
		if (/array|pointer|two.?sum|binary search/i.test(trigger)) return this.arrayDemo(step)
		return this.systemDesignDemo(step)
	}

	private review(trigger: string, step: number, lastTool: ChatMessage | undefined): Completion {
		if (step === 0) {
			return { text: 'Let me take a look at what you drew.', toolCalls: [call('get_canvas_state', { author: 'user' })] }
		}
		if (step === 1) {
			let shapes: any[] = []
			try {
				shapes = JSON.parse(textOf(lastTool!)).shapes ?? []
			} catch {}
			const userShapes = shapes.filter((s) => s.author?.kind === 'user')
			if (!userShapes.length) {
				if (trigger.startsWith('[trigger:idle]')) return { text: 'SILENT', toolCalls: [] }
				return { text: "I don't see anything drawn by you yet. Try sketching something!", toolCalls: [] }
			}
			const labels = userShapes.map((s) => s.label).filter(Boolean)
			const target = userShapes[0]
			const who = target.author?.name ? `${target.author.name}, ` : ''
			const summary = labels.length ? `I see ${labels.join(', ')}.` : `I see ${userShapes.length} shape(s).`
			return {
				text: `${who}nice work. ${summary}`,
				toolCalls: [
					call('highlight_shapes', { id: 'review_hl', shapeIds: userShapes.map((s) => s.id), color: 'green' }),
					call('add_comment', {
						id: 'review_note',
						targetShapeId: target.id,
						kind: 'praise',
						text: `Looks good! ${summary}`,
						addressedTo: target.author?.name,
					}),
				],
			}
		}
		return { text: 'Keep going, and ask me to check again whenever you like.', toolCalls: [] }
	}

	private systemDesignDemo(step: number): Completion {
		switch (step) {
			case 0:
				return {
					text: 'Let us sketch a simple web architecture. Requests start at the client and hit a load balancer.',
					toolCalls: [
						call('create_shape', { id: 'client', type: 'geo', geo: 'ellipse', x: 0, y: 0, w: 160, h: 80, label: 'Client', color: 'black' }),
						call('create_shape', { id: 'lb', type: 'geo', geo: 'rectangle', x: 260, y: 0, w: 160, h: 80, label: 'Load Balancer', color: 'blue' }),
						call('create_arrow', { id: 'a_client_lb', fromId: 'client', toId: 'lb', label: 'HTTPS' }),
					],
				}
			case 1:
				return {
					text: 'The load balancer spreads traffic across two app servers, which share one database.',
					toolCalls: [
						call('create_shape', { id: 'app1', type: 'geo', geo: 'rectangle', x: 520, y: -100, w: 160, h: 80, label: 'App Server 1', color: 'blue' }),
						call('create_shape', { id: 'app2', type: 'geo', geo: 'rectangle', x: 520, y: 100, w: 160, h: 80, label: 'App Server 2', color: 'blue' }),
						call('create_shape', { id: 'db', type: 'geo', geo: 'ellipse', x: 800, y: 0, w: 160, h: 80, label: 'Postgres', color: 'green' }),
						call('create_arrow', { id: 'a_lb_app1', fromId: 'lb', toId: 'app1' }),
						call('create_arrow', { id: 'a_lb_app2', fromId: 'lb', toId: 'app2' }),
						call('create_arrow', { id: 'a_app1_db', fromId: 'app1', toId: 'db', label: 'SQL' }),
						call('create_arrow', { id: 'a_app2_db', fromId: 'app2', toId: 'db', label: 'SQL' }),
					],
				}
			case 2:
				return {
					text: 'Your turn: draw where you would add a cache, then press Check my work.',
					toolCalls: [call('focus_view', { shapeIds: ['client', 'lb', 'app1', 'app2', 'db'], scope: 'everyone' })],
				}
			default:
				return { text: null, toolCalls: [] }
		}
	}

	private arrayDemo(step: number): Completion {
		const values = ['1', '3', '4', '6', '8', '11']
		const steps = [
			{ l: 0, r: 5, say: 'Two pointers on a sorted array, target ten. Left is one, right is eleven: twelve is too big, so right moves in.' },
			{ l: 0, r: 4, say: 'One plus eight is nine, too small, so left moves forward.' },
			{ l: 1, r: 4, say: 'Three plus eight is eleven, too big, so right moves in.' },
			{ l: 1, r: 3, say: 'Three plus six is nine, too small, so left moves forward.' },
			{ l: 2, r: 3, say: 'Four plus six is ten. Found the pair!' },
		]
		if (step < steps.length) {
			const s = steps[step]
			return {
				text: s.say,
				toolCalls: [
					call('draw_array', {
						id: 'arr',
						startX: 0,
						startY: 300,
						values,
						pointers: [
							{ index: s.l, label: 'left' },
							{ index: s.r, label: 'right' },
						],
						highlight: [s.l, s.r],
					}),
				],
			}
		}
		return { text: null, toolCalls: [] }
	}
}
