// Voice I/O.
//
// Output: the agent's lines play as Grok TTS audio streamed from the server
// (falling back to the browser's speech synthesis). Lines play in order.
//
// Input: a hands-free "conversation" mode that keeps the mic open with echo
// cancellation, detects when the student starts and stops talking, and sends
// each utterance to Grok speech-to-text through the server. Talking while the
// agent speaks interrupts it (barge-in). Without server voice, the browser's
// speech recognition is used instead.

let muted = false
const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined

type Line = { text: string; audioUrl?: string; onDone: () => void }
const queue: Line[] = []
let current: { line: Line; audio?: HTMLAudioElement } | null = null
const speakingListeners = new Set<(speaking: boolean) => void>()
let blockedListener: ((blocked: boolean) => void) | null = null

export const isSpeaking = () => current !== null
export function onSpeakingChange(fn: (speaking: boolean) => void) {
	speakingListeners.add(fn)
	return () => speakingListeners.delete(fn)
}
/** Called when the browser blocks audio until the user interacts with the page. */
export function onAudioBlocked(fn: (blocked: boolean) => void) {
	blockedListener = fn
}

function setCurrent(next: typeof current) {
	const was = current !== null
	current = next
	if (was !== (next !== null)) for (const fn of speakingListeners) fn(next !== null)
}

function finishCurrent() {
	const line = current?.line
	if (current?.audio) {
		current.audio.onended = current.audio.onerror = null
		current.audio.pause()
		current.audio.src = ''
	}
	setCurrent(null)
	line?.onDone()
	playNext()
}

function synthesize(line: Line) {
	if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return finishCurrent()
	const u = new SpeechSynthesisUtterance(line.text)
	u.rate = 1.05
	u.onend = u.onerror = () => {
		if (current?.line === line) finishCurrent()
	}
	synth.speak(u)
}

function playNext() {
	if (current || !queue.length) return
	const line = queue.shift()!
	if (muted) {
		line.onDone()
		return playNext()
	}
	setCurrent({ line })
	if (!line.audioUrl) return synthesize(line)
	const audio = new Audio(line.audioUrl)
	current!.audio = audio
	audio.onended = () => current?.line === line && finishCurrent()
	audio.onerror = () => {
		// Grok audio unavailable: say it with the browser voice instead.
		if (current?.line !== line) return
		current.audio = undefined
		synthesize(line)
	}
	audio.play().then(
		() => blockedListener?.(false),
		(err: DOMException) => {
			if (current?.line !== line) return
			if (err?.name === 'NotAllowedError') {
				// Autoplay blocked: skip this line rather than stall the lesson; the UI offers to enable sound.
				blockedListener?.(true)
				finishCurrent()
			} else audio.onerror?.(new Event('error'))
		}
	)
}

/** Queues a line; `onDone` fires once it has been heard (or skipped). */
export function speak(text: string, onDone: () => void, audioUrl?: string) {
	queue.push({ text, audioUrl, onDone })
	playNext()
}

export function stopSpeaking() {
	const pending = queue.splice(0)
	synth?.cancel()
	if (current) finishCurrent()
	for (const l of pending) l.onDone()
}

export function setMuted(value: boolean) {
	muted = value
	if (value) stopSpeaking()
}

/** Call from a user gesture to allow audio playback (autoplay policy). */
export function unlockAudio() {
	const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=')
	void a.play().then(() => blockedListener?.(false), () => {})
}

// ------------------------------------------------------------------ input

export type ListenState = 'listening' | 'hearing' | 'transcribing'

type Handlers = {
	onFinal: (text: string) => void
	onState?: (state: ListenState) => void
	onLevel?: (level: number) => void
	onSpeechStart?: () => void
	onError?: (message: string) => void
	onEnd?: () => void
}

export type Listener = { stop(): void }

export const speechRecognitionSupported = () =>
	typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

export const micSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

async function transcribe(blob: Blob): Promise<string> {
	const form = new FormData()
	const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
	form.append('file', blob, `utterance.${ext}`)
	const res = await fetch('/api/stt', { method: 'POST', body: form })
	if (!res.ok) throw new Error(`Transcription failed (${res.status})`)
	return ((await res.json()).text ?? '').trim()
}

/**
 * Hands-free listening with Grok speech-to-text: open mic, voice activity
 * detection, one transcription per utterance.
 */
export async function startConversation(h: Handlers): Promise<Listener> {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
	})
	const ctx = new AudioContext()
	const source = ctx.createMediaStreamSource(stream)
	const analyser = ctx.createAnalyser()
	analyser.fftSize = 1024
	source.connect(analyser)
	const samples = new Float32Array(analyser.fftSize)
	const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t))

	let stopped = false
	let recorder: MediaRecorder | null = null
	let chunks: Blob[] = []
	let recorderStartedAt = 0
	let noise = 0.008
	let speaking = false
	let aboveMs = 0
	let belowMs = 0
	let voicedMs = 0
	let cutting = false
	const FRAME = 30

	const startRecorder = () => {
		chunks = []
		recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
		recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
		recorder.start()
		recorderStartedAt = performance.now()
	}
	// Stops the current recording and immediately starts the next one.
	const cutRecording = async (keep: boolean) => {
		cutting = true
		const blob = await new Promise<Blob | null>((resolve) => {
			const r = recorder
			if (!r || r.state === 'inactive') return resolve(null)
			r.onstop = () => resolve(keep ? new Blob(chunks, { type: r.mimeType }) : null)
			r.stop()
		})
		if (!stopped) startRecorder()
		cutting = false
		return blob
	}

	startRecorder()
	h.onState?.('listening')

	const timer = setInterval(async () => {
		if (stopped || cutting) return
		analyser.getFloatTimeDomainData(samples)
		let sum = 0
		for (const v of samples) sum += v * v
		const rms = Math.sqrt(sum / samples.length)
		h.onLevel?.(Math.min(1, rms / 0.15))

		// Stricter while the agent is talking, so its own voice (if any leaks past
		// echo cancellation) doesn't count as the student speaking.
		const threshold = isSpeaking() ? Math.max(0.05, noise * 6) : Math.max(0.018, noise * 3)
		if (!speaking) {
			noise = noise * 0.98 + Math.min(rms, 0.05) * 0.02
			aboveMs = rms > threshold ? aboveMs + FRAME : 0
			if (aboveMs >= 150) {
				speaking = true
				belowMs = 0
				voicedMs = aboveMs
				h.onState?.('hearing')
				h.onSpeechStart?.()
			} else if (performance.now() - recorderStartedAt > 8000) {
				// Bound the leading silence kept in each recording.
				await cutRecording(false)
			}
			return
		}
		if (rms > threshold * 0.6) {
			belowMs = 0
			voicedMs += FRAME
		} else belowMs += FRAME
		if (belowMs < 800) return

		// End of utterance.
		speaking = false
		aboveMs = 0
		const blob = await cutRecording(voicedMs >= 300)
		if (!blob) return h.onState?.('listening')
		h.onState?.('transcribing')
		try {
			const text = await transcribe(blob)
			if (text) h.onFinal(text)
		} catch (err) {
			h.onError?.((err as Error).message)
		}
		if (!stopped) h.onState?.(speaking ? 'hearing' : 'listening')
	}, FRAME)

	return {
		stop() {
			if (stopped) return
			stopped = true
			clearInterval(timer)
			if (recorder?.state === 'recording') recorder.stop()
			stream.getTracks().forEach((t) => t.stop())
			void ctx.close()
			h.onEnd?.()
		},
	}
}

/** Fallback when the server has no Grok voice: the browser's own speech recognition. */
export function startBrowserRecognition(h: Handlers): Listener | null {
	const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
	if (!Ctor) return null
	const rec = new Ctor()
	rec.continuous = true
	rec.interimResults = false
	rec.lang = navigator.language || 'en-US'
	rec.onspeechstart = () => {
		h.onState?.('hearing')
		h.onSpeechStart?.()
	}
	rec.onresult = (e: any) => {
		for (let i = e.resultIndex; i < e.results.length; i++) {
			const r = e.results[i]
			if (r.isFinal) h.onFinal(r[0].transcript.trim())
		}
		h.onState?.('listening')
	}
	rec.onerror = (e: any) => e.error !== 'no-speech' && h.onError?.(e.error ?? 'speech recognition error')
	rec.onend = () => h.onEnd?.()
	rec.start()
	h.onState?.('listening')
	return { stop: () => rec.stop() }
}
