import { useEffect, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import type { Identity } from '../identity.ts'
import {
	isSpeaking,
	micSupported,
	speechRecognitionSupported,
	startBrowserRecognition,
	startConversation,
	stopSpeaking,
	unlockAudio,
	type ListenState,
	type Listener,
} from './speech.ts'
import type { AgentState, useAgent } from './useAgent.ts'
import { useLiveVoice } from './useLiveVoice.ts'

type AgentActions = ReturnType<typeof useAgent>['actions']
export type OrbState = 'idle' | 'thinking' | 'speaking' | 'offline'

const LIVE_KEY = 'grok-whiteboard:live'
const LIVE_STATUS = { connecting: 'Live · Connecting…', listening: 'Live · Listening', hearing: 'Live · Hearing you…', thinking: 'Live · Thinking…', speaking: 'Live · Speaking…' }

/**
 * The hands-free voice conversation (mic open, each utterance sent to the
 * agent), shared by the Agent panel's mic and the floating mic over the canvas.
 * Call it once (in Board) and pass the result down so both drive the same session.
 */
export function useVoice(editor: Editor | null, me: Identity, state: AgentState, actions: AgentActions) {
	const [listenState, setListenState] = useState<ListenState | null>(null)
	const [level, setLevel] = useState(0)
	const [micError, setMicError] = useState<string | null>(null)
	const [liveMode, setLiveModeState] = useState(() => {
		try {
			return localStorage.getItem(LIVE_KEY) === '1'
		} catch {
			return false
		}
	})
	const live = useLiveVoice(editor, me, actions)
	const useLive = liveMode && state.realtime
	const recRef = useRef<Listener | null>(null)
	const listening = listenState !== null || live.active

	useEffect(() => () => recRef.current?.stop(), [])

	const stopListening = () => {
		recRef.current?.stop()
		recRef.current = null
		setListenState(null)
		setLevel(0)
	}

	const setLiveMode = (on: boolean) => {
		if (live.active) live.stop()
		if (listenState) stopListening()
		setLiveModeState(on)
		try {
			localStorage.setItem(LIVE_KEY, on ? '1' : '0')
		} catch {}
	}

	const toggleMic = async () => {
		// Live voice: set up synchronously inside the click (browser audio rules).
		if (live.active) return live.stop()
		if (useLive && !listenState) return live.start()
		if (listening) return stopListening()
		unlockAudio()
		const handlers = {
			onState: setListenState,
			onLevel: setLevel,
			// Barge-in: talking over the agent cuts its voice off right away; the
			// transcript then interrupts the agent's turn on the server.
			onSpeechStart: () => isSpeaking() && stopSpeaking(),
			onFinal: (t: string) => t && actions.say(t),
			onError: (m: string) => setMicError(m),
			onEnd: () => {
				recRef.current = null
				setListenState(null)
			},
		}
		setMicError(null)
		try {
			recRef.current = state.voice === 'grok' && micSupported() ? await startConversation(handlers) : startBrowserRecognition(handlers)
			if (!recRef.current) setMicError('Voice input is not supported in this browser.')
		} catch (err) {
			setMicError((err as Error).name === 'NotAllowedError' ? 'Microphone access was denied.' : (err as Error).message)
			setListenState(null)
		}
	}

	/** Sends typed text to whichever conversation is active. */
	const sendText = (text: string) => {
		if (live.active) live.sendText(text)
		else actions.say(text)
	}

	const orbState: OrbState = live.state
		? live.state === 'speaking'
			? 'speaking'
			: live.state === 'thinking' || live.state === 'connecting'
				? 'thinking'
				: 'idle'
		: !state.connected
			? 'offline'
			: state.speaking
				? 'speaking'
				: state.busy
					? 'thinking'
					: 'idle'
	const status = live.state
		? LIVE_STATUS[live.state]
		: !state.connected
			? 'Connecting…'
			: state.activity || (state.speaking ? 'Speaking…' : state.busy ? 'Working…' : 'Ready')

	return {
		supported: micSupported() || speechRecognitionSupported(),
		listenState,
		listening,
		level: live.active ? live.level : level,
		error: live.error ?? micError,
		live,
		liveMode,
		setLiveMode,
		toggleMic,
		sendText,
		critique: live.active ? live.checkWork : actions.checkWork,
		orbState,
		status,
	}
}

export type Voice = ReturnType<typeof useVoice>
