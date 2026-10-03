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

export interface LLMProvider {
	readonly name: string
	complete(messages: ChatMessage[], tools: ToolDef[], signal: AbortSignal): Promise<Completion>
}

export class GrokProvider implements LLMProvider {
	readonly name: string

	constructor(
		private apiKey: string,
		private model: string,
		private baseUrl = 'https://api.x.ai/v1'
	) {
		this.name = `xai:${model}`
	}

	async complete(messages: ChatMessage[], tools: ToolDef[], signal: AbortSignal): Promise<Completion> {
		const res = await fetch(`${this.baseUrl}/chat/completions`, {
			method: 'POST',
			signal,
			headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify({
				model: this.model,
				messages,
				tools: tools.map((t) => ({ type: 'function', function: t })),
				tool_choice: 'auto',
			}),
		})
		if (!res.ok) {
			throw new Error(`xAI API error ${res.status}: ${(await res.text()).slice(0, 500)}`)
		}
		const json: any = await res.json()
		const msg = json.choices?.[0]?.message ?? {}
		return { text: msg.content || null, toolCalls: msg.tool_calls ?? [] }
	}
}
