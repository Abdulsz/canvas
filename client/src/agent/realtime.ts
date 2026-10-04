// Live voice: a speech-to-speech session with xAI's realtime API
// (wss://api.x.ai/v1/realtime), following the protocol in xAI's docs:
// https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech
//
// - Mic audio streams as 24 kHz PCM16 (input_audio_buffer.append); the server's
//   VAD decides when the student has finished speaking and barges in.
// - Grok's audio streams back as PCM16 and plays immediately.
// - Function calls (drawing, reading the board) run here, their outputs go back
//   right away, and response.create is sent once playback of the current turn
//   finishes, so the next turn's audio doesn't overlap this one.

export type LiveState = 'connecting' | 'listening' | 'hearing' | 'thinking' | 'speaking'

export type LiveHandlers = {
	onState: (state: LiveState) => void
	onTranscript: (who: 'user' | 'agent', text: string) => void
	onToolCall: (name: string, args: Record<string, any>) => Promise<unknown>
	onLevel?: (level: number) => void
	onError: (message: string) => void
	onClose: () => void
}

type SessionInfo = { url: string; token: string; session: Record<string, unknown> }

const RATE = 24000

// Captures mic samples on the audio thread and posts them to the main thread.
const WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('capture', Capture)
`

function toBase64PCM16(samples: Float32Array): string {
	const pcm = new Int16Array(samples.length)
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]))
		pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
	}
	const bytes = new Uint8Array(pcm.buffer)
	let bin = ''
	for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	return btoa(bin)
}

function fromBase64PCM16(b64: string): Float32Array {
	const bin = atob(b64)
	const bytes = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
	const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1)
	const out = new Float32Array(pcm.length)
	for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768
	return out
}

export class LiveVoiceSession {
	private ctx: AudioContext
	private ws: WebSocket | null = null
	private stream: MediaStream | null = null
	private pending: Float32Array[] = []
	private pendingLen = 0
	private earlyAudio: string[] = []
	private closed = false

	// Playback
	private nextTime = 0
	private sources = new Set<AudioBufferSourceNode>()
	private playingItem: { id: string; startedAt: number } | null = null

	// Turn state
	private calls: Promise<void>[] = []
	private callCount = 0
	private agentText = ''
	private state: LiveState = 'connecting'

	/** Must be constructed synchronously inside a click/tap handler (Safari's autoplay rules). */
	constructor(private h: LiveHandlers) {
		this.ctx = new AudioContext({ sampleRate: RATE })
		void this.ctx.resume()
	}

	private setState(s: LiveState) {
		if (this.state === s) return
		this.state = s
		this.h.onState(s)
	}

	private send(event: Record<string, unknown>) {
		if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event))
	}

	async start() {
		this.h.onState('connecting')
		// Start the mic and the session request in parallel (xAI's latency recommendation).
		const [info] = await Promise.all([this.fetchSession(), this.startMic()])
		if (this.closed) return
		const ws = new WebSocket(info.url, [`xai-client-secret.${info.token}`])
		this.ws = ws
		ws.onopen = () => {
			this.send({ type: 'session.update', session: info.session })
			for (const audio of this.earlyAudio.splice(0)) this.send({ type: 'input_audio_buffer.append', audio })
			this.setState('listening')
		}
		ws.onmessage = (e) => {
			if (typeof e.data !== 'string') return
			try {
				this.onEvent(JSON.parse(e.data))
			} catch (err) {
				console.error('[live voice]', err)
			}
		}
		ws.onerror = () => this.h.onError('Live voice connection failed.')
		ws.onclose = () => this.stop()
	}

	private async fetchSession(): Promise<SessionInfo> {
		const r = await fetch('/api/realtime/session', { method: 'POST' })
		if (!r.ok) throw new Error(`Could not start live voice (${r.status}).`)
		return r.json()
	}

	private async startMic() {
		this.stream = await navigator.mediaDevices.getUserMedia({
			audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
		})
		const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
		await this.ctx.audioWorklet.addModule(url)
		URL.revokeObjectURL(url)
		const source = this.ctx.createMediaStreamSource(this.stream)
		const node = new AudioWorkletNode(this.ctx, 'capture')
		node.port.onmessage = (e: MessageEvent<Float32Array>) => this.onMicSamples(e.data)
		source.connect(node)
		// The node must be pulled by the graph to run; route it through a muted gain.
		const mute = this.ctx.createGain()
		mute.gain.value = 0
		node.connect(mute).connect(this.ctx.destination)
	}

	private onMicSamples(samples: Float32Array) {
		let sum = 0
		for (const v of samples) sum += v * v
		this.h.onLevel?.(Math.min(1, Math.sqrt(sum / samples.length) / 0.15))
		this.pending.push(samples)
		this.pendingLen += samples.length
		if (this.pendingLen < RATE / 10) return // send ~100ms per message
		const chunk = new Float32Array(this.pendingLen)
		let o = 0
		for (const p of this.pending) {
			chunk.set(p, o)
			o += p.length
		}
		this.pending = []
		this.pendingLen = 0
		const audio = toBase64PCM16(chunk)
		if (this.ws?.readyState === WebSocket.OPEN) this.send({ type: 'input_audio_buffer.append', audio })
		else if (this.earlyAudio.length < 50) this.earlyAudio.push(audio) // buffer up to ~5s while connecting
	}

	// ------------------------------------------------------------ events

	private onEvent(ev: any) {
		switch (ev.type) {
			case 'input_audio_buffer.speech_started':
				// Barge-in: stop playback and tell the server how much of its reply was heard.
				this.interruptPlayback()
				this.setState('hearing')
				break
			case 'input_audio_buffer.speech_stopped':
				this.setState('thinking')
				break
			case 'conversation.item.input_audio_transcription.completed':
				if (ev.transcript?.trim()) this.h.onTranscript('user', ev.transcript.trim())
				break
			case 'response.created':
				this.agentText = ''
				this.calls = []
				this.callCount = 0
				this.setState('thinking')
				break
			case 'response.output_audio.delta':
				this.play(ev.item_id, fromBase64PCM16(ev.delta))
				break
			case 'response.output_audio_transcript.delta':
				this.agentText += ev.delta ?? ''
				break
			case 'response.output_audio_transcript.done':
				if ((ev.transcript ?? this.agentText).trim()) this.h.onTranscript('agent', (ev.transcript ?? this.agentText).trim())
				this.agentText = ''
				break
			case 'response.function_call_arguments.done':
				this.callCount++
				this.calls.push(this.runCall(ev.call_id, ev.name, ev.arguments))
				break
			case 'response.done':
				void this.finishResponse()
				break
			case 'error':
				this.h.onError(ev.error?.message ?? 'Live voice error.')
				break
		}
	}

	private async runCall(callId: string, name: string, rawArgs: string) {
		let output: unknown
		try {
			output = await this.h.onToolCall(name, rawArgs ? JSON.parse(rawArgs) : {})
		} catch (err) {
			output = { ok: false, error: (err as Error).message }
		}
		this.send({
			type: 'conversation.item.create',
			item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output).slice(0, 12000) },
		})
	}

	private async finishResponse() {
		if (!this.callCount) {
			if (!this.sources.size) this.setState('listening')
			return
		}
		// Send every output before asking for the next turn, and let this turn's audio finish first.
		await Promise.all(this.calls)
		await this.playbackDone()
		if (!this.closed) this.send({ type: 'response.create' })
	}

	// ----------------------------------------------------------- playback

	private play(itemId: string, samples: Float32Array) {
		if (!samples.length) return
		const buf = this.ctx.createBuffer(1, samples.length, RATE)
		buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
		const src = this.ctx.createBufferSource()
		src.buffer = buf
		src.connect(this.ctx.destination)
		const at = Math.max(this.ctx.currentTime + 0.02, this.nextTime)
		if (!this.playingItem || this.playingItem.id !== itemId) this.playingItem = { id: itemId, startedAt: at }
		src.start(at)
		this.nextTime = at + buf.duration
		this.sources.add(src)
		this.setState('speaking')
		src.onended = () => {
			this.sources.delete(src)
			if (!this.sources.size && this.state === 'speaking') this.setState('listening')
		}
	}

	private interruptPlayback() {
		if (!this.sources.size) return
		const item = this.playingItem
		for (const s of this.sources) {
			s.onended = null
			try {
				s.stop()
			} catch {}
		}
		this.sources.clear()
		if (item) {
			const heardMs = Math.max(0, Math.round((this.ctx.currentTime - item.startedAt) * 1000))
			this.send({ type: 'conversation.item.truncate', item_id: item.id, content_index: 0, audio_end_ms: heardMs })
		}
		this.playingItem = null
		this.nextTime = 0
	}

	private playbackDone(): Promise<void> {
		const remaining = Math.max(0, this.nextTime - this.ctx.currentTime)
		return new Promise((r) => setTimeout(r, remaining * 1000))
	}

	isSpeaking() {
		return this.sources.size > 0
	}

	// ------------------------------------------------------------ control

	/** Sends a typed message (or app context such as "Check my work") as a user turn. */
	sendText(text: string) {
		this.interruptPlayback()
		this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })
		this.send({ type: 'response.create' })
	}

	stop() {
		if (this.closed) return
		this.closed = true
		this.interruptPlayback()
		this.stream?.getTracks().forEach((t) => t.stop())
		if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close()
		void this.ctx.close()
		this.h.onClose()
	}
}
