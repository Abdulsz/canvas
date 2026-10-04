// Messages exchanged on the /agent/:roomId WebSocket. Canvas data itself
// travels over the separate tldraw sync socket (/sync/:roomId).

export type ReviewMode = 'on_request' | 'proactive' | 'exercise'

export type Author = { kind: 'user' | 'agent'; id: string; name: string }

export type Participant = { userId: string; name: string; color: string }

export type ToolResult = {
	ok: boolean
	data?: unknown
	error?: string
	/** PNG data URL, for get_canvas_image */
	image?: string
}

export type ClientMessage =
	| { type: 'hello'; userId: string; name: string; color: string }
	| { type: 'user_message'; text: string; selection: string[] }
	| { type: 'check_work'; shapeIds: string[] }
	| { type: 'set_mode'; mode: ReviewMode }
	| { type: 'tool_result'; callId: string; result: ToolResult }
	| { type: 'speech_done'; sayId: string }
	| { type: 'agent_cursor'; x: number; y: number }
	| { type: 'stop' }

export type ServerMessage =
	| {
			type: 'room_state'
			mode: ReviewMode
			busy: boolean
			participants: Participant[]
			provider: string
			/** 'grok': Grok speech in/out through the server. 'browser': Web Speech API fallback. */
			voice: 'grok' | 'browser'
			/** Live voice (xAI speech-to-speech in the browser) is available. */
			realtime: boolean
	  }
	| {
			type: 'tool_call'
			callId: string
			name: string
			args: Record<string, any>
			/** Present when the call touches student-authored shapes: the client must ask before running it. */
			confirm?: { message: string }
	  }
	/** `report`: this client should send speech_done when it finishes speaking the line. */
	| { type: 'agent_say'; sayId: string; text: string; report: boolean; audioUrl?: string }
	| { type: 'agent_status'; busy: boolean; activity: string }
	| { type: 'agent_cursor'; x: number; y: number }
	| { type: 'chat'; from: string; text: string }
	| { type: 'focus'; shapeIds: string[]; zoomLevel?: number }
	| { type: 'stop_speech' }
	| { type: 'error'; message: string }

export const AGENT_NAME = 'Professor Grok'
export const AGENT_COLOR = '#7c3aed'
