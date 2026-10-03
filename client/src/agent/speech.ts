// Browser voice I/O. Uses the Web Speech API (speech synthesis for the
// agent's voice, speech recognition for students). Swap these two functions
// for a streaming Grok voice client without touching the rest of the app.

let muted = false
const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined

export function setMuted(value: boolean) {
	muted = value
	if (value) synth?.cancel()
}

export function stopSpeaking() {
	synth?.cancel()
}

/** Speaks a line; `onDone` fires when it finishes (or immediately if muted/unsupported). */
export function speak(text: string, onDone: () => void) {
	if (muted || !synth || typeof SpeechSynthesisUtterance === 'undefined') {
		onDone()
		return
	}
	const u = new SpeechSynthesisUtterance(text)
	u.rate = 1.05
	let finished = false
	const finish = () => {
		if (finished) return
		finished = true
		onDone()
	}
	u.onend = finish
	u.onerror = finish
	synth.speak(u)
}

type Recognizer = { start(): void; stop(): void }

export const speechRecognitionSupported = () =>
	typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

/**
 * Starts continuous recognition. `onSpeechStart` lets the app cut off the
 * agent's voice (barge-in); `onFinal` receives each finished utterance.
 */
export function startListening(handlers: {
	onFinal: (text: string) => void
	onInterim?: (text: string) => void
	onSpeechStart?: () => void
	onEnd?: () => void
	onError?: (message: string) => void
}): Recognizer | null {
	const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
	if (!Ctor) return null
	const rec = new Ctor()
	rec.continuous = true
	rec.interimResults = true
	rec.lang = navigator.language || 'en-US'
	rec.onspeechstart = () => handlers.onSpeechStart?.()
	rec.onresult = (e: any) => {
		let interim = ''
		for (let i = e.resultIndex; i < e.results.length; i++) {
			const r = e.results[i]
			if (r.isFinal) handlers.onFinal(r[0].transcript.trim())
			else interim += r[0].transcript
		}
		handlers.onInterim?.(interim)
	}
	rec.onerror = (e: any) => handlers.onError?.(e.error ?? 'speech recognition error')
	rec.onend = () => handlers.onEnd?.()
	rec.start()
	return rec
}
