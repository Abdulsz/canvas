import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import type { ClientMessage, Participant, ReviewMode, ServerMessage } from '../../../shared/protocol.ts'
import type { Identity } from '../identity.ts'
import { CanvasExecutor } from './executor.ts'
import { speak, stopSpeaking } from './speech.ts'

export type LogEntry = { id: number; from: string; text: string; kind: 'agent' | 'user' | 'error' }

export type AgentState = {
	connected: boolean
	mode: ReviewMode
	busy: boolean
	speaking: boolean
	activity: string
	provider: string
	participants: Participant[]
	log: LogEntry[]
	agentCursor: { x: number; y: number } | null
	pendingConfirm: { message: string; resolve: (ok: boolean) => void } | null
}

let logSeq = 0

/** Connects this tab to the room's agent and runs the tool calls it sends here. */
export function useAgent(roomId: string, me: Identity, editor: Editor | null) {
	const [state, setState] = useState<AgentState>({
		connected: false,
		mode: 'on_request',
		busy: false,
		speaking: false,
		activity: '',
		provider: '',
		participants: [],
		log: [],
		agentCursor: null,
		pendingConfirm: null,
	})
	const wsRef = useRef<WebSocket | null>(null)
	const editorRef = useRef(editor)
	editorRef.current = editor

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
					setState((s) => ({ ...s, mode: msg.mode, busy: msg.busy, participants: msg.participants, provider: msg.provider }))
					break
				case 'agent_status':
					setState((s) => ({ ...s, busy: msg.busy, activity: msg.activity }))
					break
				case 'agent_say':
					addLog({ from: 'Professor Grok', text: msg.text, kind: 'agent' })
					setState((s) => ({ ...s, speaking: true }))
					speak(msg.text, () => {
						setState((s) => ({ ...s, speaking: false }))
						if (msg.report) send({ type: 'speech_done', sayId: msg.sayId })
					})
					break
				case 'chat':
					addLog({ from: msg.from, text: msg.text, kind: 'user' })
					break
				case 'error':
					addLog({ from: 'System', text: msg.message, kind: 'error' })
					break
				case 'agent_cursor':
					setState((s) => ({ ...s, agentCursor: { x: msg.x, y: msg.y } }))
					break
				case 'stop_speech':
					stopSpeaking()
					setState((s) => ({ ...s, speaking: false }))
					break
				case 'focus':
					void executor.run('focus_view', { shapeIds: msg.shapeIds, zoomLevel: msg.zoomLevel })
					break
				case 'tool_call': {
					if (msg.confirm && !(await confirm(msg.confirm.message))) {
						send({ type: 'tool_result', callId: msg.callId, result: { ok: false, error: 'The student declined this change. Annotate next to their work instead.' } })
						break
					}
					const result = await executor.run(msg.name, msg.args)
					send({ type: 'tool_result', callId: msg.callId, result })
					break
				}
			}
		}

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
			clearTimeout(retry)
			wsRef.current?.close()
		}
	}, [editor, roomId, me, send, addLog, confirm])

	const actions = {
		say: (text: string) => send({ type: 'user_message', text, selection: editorRef.current?.getSelectedShapeIds() ?? [] }),
		checkWork: () => send({ type: 'check_work', shapeIds: editorRef.current?.getSelectedShapeIds() ?? [] }),
		setMode: (mode: ReviewMode) => send({ type: 'set_mode', mode }),
		stop: () => {
			stopSpeaking()
			send({ type: 'stop' })
		},
	}
	return { state, actions }
}
