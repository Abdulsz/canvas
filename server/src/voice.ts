import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * One spoken line. Synthesis starts as soon as the agent decides what to say,
 * and the audio is fanned out to every listener in the room from a single
 * xAI request, streaming to late joiners from what has arrived so far.
 */
class Clip {
	chunks: Buffer[] = []
	done = false
	failed = false
	private listeners = new Set<() => void>()

	constructor(promise: Promise<Response>) {
		void this.pump(promise)
	}

	private async pump(promise: Promise<Response>) {
		try {
			const res = await promise
			if (!res.ok || !res.body) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 200)}`)
			for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
				this.chunks.push(Buffer.from(chunk))
				this.notify()
			}
		} catch (err) {
			console.error('[voice] synthesis failed:', (err as Error).message)
			this.failed = true
		}
		this.done = true
		this.notify()
	}

	private notify() {
		for (const l of this.listeners) l()
	}

	pipe(res: ServerResponse) {
		let sent = 0
		const flush = () => {
			if (this.failed && sent === 0) {
				cleanup()
				if (!res.headersSent) res.writeHead(502)
				return res.end()
			}
			if (!res.headersSent) res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' })
			while (sent < this.chunks.length) res.write(this.chunks[sent++])
			if (this.done) {
				cleanup()
				res.end()
			}
		}
		const cleanup = () => this.listeners.delete(flush)
		res.on('close', cleanup)
		this.listeners.add(flush)
		if (this.chunks.length || this.done) flush()
	}
}

// How the agent should say common technical terms (respellings, applied before synthesis only).
const PRONUNCIATIONS: Record<string, string> = {
	gRPC: 'G R P C',
	nginx: 'engine x',
	PostgreSQL: 'post gres Q L',
	k8s: 'kubernetes',
	OAuth: 'oh auth',
	SQLite: 'S Q lite',
	DynamoDB: 'dynamo D B',
	'LeetCode': 'leet code',
}

export class VoiceService {
	private clips = new Map<string, Clip>()
	private cached = new Map<string, Clip>()

	constructor(
		private apiKey: string,
		private baseUrl = 'https://api.x.ai/v1',
		readonly voiceId = 'ara',
		private language = 'en'
	) {}

	/** Starts synthesizing a line; returns the URL clients play it from. */
	prepare(key: string, text: string): string {
		const clip = this.synthesize(text)
		this.clips.set(key, clip)
		// Keep only recent lines.
		if (this.clips.size > 200) this.clips.delete(this.clips.keys().next().value!)
		return `/api/tts/${encodeURIComponent(key)}`
	}

	/** Like prepare, but synthesizes each distinct text once and reuses the audio (for fillers). */
	prepareCached(text: string): string {
		const key = `c-${Buffer.from(text).toString('base64url').slice(0, 100)}`
		const existing = this.cached.get(key)
		if (!existing || existing.failed) this.cached.set(key, this.synthesize(text))
		return `/api/tts/${key}`
	}

	/** Synthesizes lines ahead of time so their first use plays instantly. */
	warm(texts: string[]) {
		for (const t of texts) this.prepareCached(t)
	}

	private synthesize(text: string): Clip {
		return new Clip(
			fetch(`${this.baseUrl}/tts`, {
				method: 'POST',
				signal: AbortSignal.timeout(30_000),
				headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
				body: JSON.stringify({
					text,
					voice_id: this.voiceId,
					language: this.language,
					// Smaller first chunk: audio starts ~0.15s after the request instead of ~0.5s.
					optimize_streaming_latency: 1,
					// Read "O(n log n)", "HTTP/2" and numbers the way a person would.
					text_normalization: true,
					replace: PRONUNCIATIONS,
				}),
			})
		)
	}

	serve(key: string, res: ServerResponse) {
		const clip = this.clips.get(key) ?? this.cached.get(key)
		if (!clip) return res.writeHead(404).end()
		clip.pipe(res)
	}

	/** Proxies a recorded utterance (multipart form with a `file` field) to xAI speech-to-text. */
	async transcribe(req: IncomingMessage, res: ServerResponse) {
		const chunks: Buffer[] = []
		let size = 0
		for await (const chunk of req) {
			size += chunk.length
			if (size > 15 * 1024 * 1024) return res.writeHead(413).end()
			chunks.push(chunk)
		}
		const upstream = await fetch(`${this.baseUrl}/stt`, {
			method: 'POST',
			signal: AbortSignal.timeout(30_000),
			headers: { 'content-type': req.headers['content-type'] ?? 'application/octet-stream', authorization: `Bearer ${this.apiKey}` },
			body: Buffer.concat(chunks),
		})
		const body = await upstream.text()
		res.writeHead(upstream.status, { 'content-type': 'application/json' }).end(body)
	}
}
