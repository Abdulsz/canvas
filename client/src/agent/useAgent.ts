import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import { AGENT_NAME, type ClientMessage, type Participant, type ReviewMode, type ServerMessage } from '../../../shared/protocol.ts'
import type { Identity } from '../identity.ts'
import { CanvasExecutor } from './executor.ts'
import { onAudioBlocked, onSpeakingChange, speak, stopSpeaking } from './speech.ts'

export type LogEntry = { id: number; from: string; text: string; kind: 'agent' | 'user' | 'error' }

export type AgentState = {
	connected: boolean
	mode: ReviewMode
	busy: boolean
	speaking: boolean
	activity: string
	provider: string
	voice: 'grok' | 'browser'
	realtime: boolean
	audioBlocked: boolean
	participants: Participant[]
	log: LogEntry[]
	agentCursor: { x: number; y: number } | null
	pendingConfirm: { message: string; resolve: (ok: boolean) => void } | null
}

let logSeq = 0
const AGENT_CURSOR_IDLE_MS = 3000

type AgentHooks = {
	/** After the agent's focus_view ran in this tab: the shell refits for what is visible here (dock, phone sheet). */
	onFocus?: (shapeIds: string[], zoomLevel?: number) => void
}

/** Connects this tab to the room's agent and runs the tool calls it sends here. */
export function useAgent(roomId: string, me: Identity, editor: Editor | null, hooks: AgentHooks = {}) {
	const [state, setState] = useState<AgentState>({
		connected: false,
		mode: 'on_request',
		busy: false,
		speaking: false,
		activity: '',
		provider: '',
		voice: 'browser',
		realtime: false,
		audioBlocked: false,
		participants: [],
		log: [],
		agentCursor: null,
		pendingConfirm: null,
	})
	const wsRef = useRef<WebSocket | null>(null)
	const editorRef = useRef(editor)
	editorRef.current = editor
	const hooksRef = useRef(hooks)
	hooksRef.current = hooks
	const focused = (args: Record<string, unknown>) => {
		const ids = Array.isArray(args.shapeIds) ? (args.shapeIds as string[]) : []
		const zoom = Number(args.zoomLevel)
		if (ids.length) hooksRef.current.onFocus?.(ids, zoom > 0 ? zoom : undefined)
	}

	const send = useCallback((msg: ClientMessage) => {
		const ws = wsRef.current
		if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
	}, [])

	const addLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
		setState((s) => ({ ...s, log: [...s.log.slice(-199), { ...entry, id: ++logSeq }] }))
	}, [])

	const confirm = useCallback(
		(message: string) =>
			new Promise<boolean>((resolve) => {
				setState((s) => ({
					...s,
					pendingConfirm: {
						message,
						resolve: (ok) => {
							setState((s2) => ({ ...s2, pendingConfirm: null }))
							resolve(ok)
						},
					},
				}))
			}),
		[]
	)

	useEffect(() => {
		if (!editor) return
		let closed = false
		let retry: ReturnType<typeof setTimeout> | undefined
		const setCursor = (x: number, y: number) => {
			setState((s) => ({ ...s, agentCursor: { x, y } }))
			send({ type: 'agent_cursor', x, y })
		}
		const executor = new CanvasExecutor(editor, { onAgentCursor: setCursor })

		const onMessage = async (msg: ServerMessage) => {
			switch (msg.type) {
				case 'room_state':
					setState((s) => ({ ...s, mode: msg.mode, busy: msg.busy, participants: msg.participants, provider: msg.provider, voice: msg.voice, realtime: !!msg.realtime }))
					break
				case 'agent_status':
					setState((s) => ({ ...s, busy: msg.busy, activity: msg.activity }))
					break
				case 'agent_say':
					if (!msg.ephemeral) addLog({ from: AGENT_NAME, text: msg.text, kind: 'agent' })
					speak(
						msg.text,
						() => {
							if (msg.report) send({ type: 'speech_done', sayId: msg.sayId })
						},
						msg.audioUrl
					)
					break
				case 'chat':
					// The server echoes a Critique press as "✅ Critique"; show it as plain words, like the live-voice path does.
					addLog({ from: msg.from, text: /^[^\w\s]+\s*Critique$/u.test(msg.text.trim()) ? 'Critique my design' : msg.text, kind: 'user' })
					break
				case 'error':
					addLog({ from: 'System', text: msg.message, kind: 'error' })
					break
				case 'agent_cursor':
					setState((s) => ({ ...s, agentCursor: { x: msg.x, y: msg.y } }))
					break
				case 'stop_speech':
					stopSpeaking()
					break
				case 'focus': {
					const args = { shapeIds: msg.shapeIds, zoomLevel: msg.zoomLevel }
					if ((await executor.run('focus_view', args)).ok) focused(args)
					break
				}
				case 'tool_call': {
					if (msg.confirm && !(await confirm(msg.confirm.message))) {
						send({ type: 'tool_result', callId: msg.callId, result: { ok: false, error: 'The user declined this change. Leave their nodes as they are, or ask first.' } })
						break
					}
					const result = await executor.run(msg.name, msg.args)
					send({ type: 'tool_result', callId: msg.callId, result })
					if (msg.name === 'focus_view' && result.ok) focused(msg.args as Record<string, unknown>)
					break
				}
			}
		}

		const offSpeaking = onSpeakingChange((speaking) => setState((s) => ({ ...s, speaking })))
		onAudioBlocked((audioBlocked) => setState((s) => ({ ...s, audioBlocked })))

		const connect = () => {
			const proto = location.protocol === 'https:' ? 'wss' : 'ws'
			const ws = new WebSocket(`${proto}://${location.host}/agent/${roomId}`)
			wsRef.current = ws
			ws.onopen = () => {
				setState((s) => ({ ...s, connected: true }))
				ws.send(JSON.stringify({ type: 'hello', ...me } satisfies ClientMessage))
			}
			ws.onmessage = (e) => {
				try {
					void onMessage(JSON.parse(e.data))
				} catch {}
			}
			ws.onclose = () => {
				setState((s) => ({ ...s, connected: false }))
				if (!closed) retry = setTimeout(connect, 1500)
			}
		}
		connect()
		return () => {
			closed = true
			offSpeaking()
			clearTimeout(retry)
			wsRef.current?.close()
		}
	}, [editor, roomId, me, send, addLog, confirm])

	// The agent's cursor parks where it last worked; once the agent has been idle
	// (not busy, not speaking) for a few seconds, it leaves the canvas.
	useEffect(() => {
		if (state.busy || state.speaking || !state.agentCursor) return
		const t = setTimeout(() => setState((s) => (s.busy || s.speaking ? s : { ...s, agentCursor: null })), AGENT_CURSOR_IDLE_MS)
		return () => clearTimeout(t)
	}, [state.busy, state.speaking, state.agentCursor])

	const actions = {
		say: (text: string) => send({ type: 'user_message', text, selection: editorRef.current?.getSelectedShapeIds() ?? [] }),
		checkWork: () => send({ type: 'check_work', shapeIds: editorRef.current?.getSelectedShapeIds() ?? [] }),
		setMode: (mode: ReviewMode) => send({ type: 'set_mode', mode }),
		stop: () => {
			stopSpeaking()
			send({ type: 'stop' })
		},
		// Used by live voice mode, which talks to xAI directly from this tab.
		log: (from: string, text: string, kind: LogEntry['kind']) => addLog({ from, text, kind }),
		agentCursor: (x: number, y: number) => {
			setState((s) => ({ ...s, agentCursor: { x, y } }))
			send({ type: 'agent_cursor', x, y })
		},
		confirm,
	}
	return { state, actions }
}
