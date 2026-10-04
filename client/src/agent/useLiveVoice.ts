import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import { AGENT_NAME } from '../../../shared/protocol.ts'
import type { Identity } from '../identity.ts'
import { CanvasExecutor, studentWorkPrompt } from './executor.ts'
import { LiveVoiceSession, type LiveState } from './realtime.ts'
import { stopSpeaking } from './speech.ts'
import type { useAgent } from './useAgent.ts'

type AgentActions = ReturnType<typeof useAgent>['actions']

/** The voice model can't see images: snapshot the board and have a vision model describe it. */
async function lookAtBoard(executor: CanvasExecutor, args: Record<string, any>) {
	const scope = Array.isArray(args.shapeIds) && args.shapeIds.length ? { shapeIds: args.shapeIds } : {}
	const state = await executor.run('get_canvas_state', scope)
	const image = await executor.run('get_canvas_image', scope)
	if (!image.ok || !image.image) return image
	const r = await fetch('/api/describe', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ image: image.image, state: state.data, question: args.question }),
	})
	if (!r.ok) return { ok: false, error: `Could not look at the board (${r.status}).` }
	return { ok: true, description: (await r.json()).description }
}

/** Live (speech-to-speech) voice mode for this tab. */
export function useLiveVoice(editor: Editor | null, me: Identity, actions: AgentActions) {
	const [state, setState] = useState<LiveState | null>(null)
	const [level, setLevel] = useState(0)
	const [error, setError] = useState<string | null>(null)
	const sessionRef = useRef<LiveVoiceSession | null>(null)
	const actionsRef = useRef(actions)
	actionsRef.current = actions

	useEffect(() => () => sessionRef.current?.stop(), [])

	/** Call directly from a click handler: audio must be set up during the user gesture. */
	const start = useCallback(() => {
		if (!editor || sessionRef.current) return
		setError(null)
		stopSpeaking()
		const executor = new CanvasExecutor(editor, { onAgentCursor: (x, y) => actionsRef.current.agentCursor(x, y) })
		const session = new LiveVoiceSession({
			onState: setState,
			onLevel: setLevel,
			onTranscript: (who, text) =>
				who === 'agent' ? actionsRef.current.log(AGENT_NAME, text, 'agent') : actionsRef.current.log(me.name, text, 'user'),
			onToolCall: async (name, args) => {
				const prompt = studentWorkPrompt(editor, name, args)
				if (prompt && !(await actionsRef.current.confirm(prompt))) {
					return { ok: false, error: 'The student declined this change. Annotate next to their work instead.' }
				}
				if (name === 'look_at_board') return lookAtBoard(executor, args)
				const result = await executor.run(name, args)
				// The voice model only takes text; never send it image data.
				return result.image ? { ...result, image: undefined } : result
			},
			onError: setError,
			onClose: () => {
				sessionRef.current = null
				setState(null)
				setLevel(0)
			},
		})
		sessionRef.current = session
		session.start().catch((err: Error) => {
			setError(err.name === 'NotAllowedError' ? 'Microphone access was denied.' : err.message)
			session.stop()
		})
	}, [editor, me])

	const stop = useCallback(() => sessionRef.current?.stop(), [])

	const sendText = useCallback(
		(text: string) => {
			actionsRef.current.log(me.name, text, 'user')
			sessionRef.current?.sendText(text)
		},
		[me]
	)

	const checkWork = useCallback(async () => {
		if (!editor || !sessionRef.current) return
		const selection = editor.getSelectedShapeIds()
		actionsRef.current.log(me.name, '✅ Check my work', 'user')
		const state = await new CanvasExecutor(editor).run('get_canvas_state', selection.length ? { shapeIds: selection } : { author: 'user' })
		sessionRef.current.sendText(
			`${me.name} pressed "Check my work"${selection.length ? ' with some shapes selected (review only those)' : ''}. ` +
				`Their shapes: ${JSON.stringify(state.data).slice(0, 6000)}. ` +
				'If any are freehand or unlabeled, call look_at_board first. Give feedback out loud and on the board.'
		)
	}, [editor, me])

	return { active: state !== null, state, level, error, start, stop, sendText, checkWork }
}
