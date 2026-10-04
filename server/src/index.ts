import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { AgentSession } from './agent.ts'
import { GrokProvider, type LLMProvider } from './llm.ts'
import { MockProvider } from './mock.ts'
import { RoomManager } from './rooms.ts'
import { VoiceService } from './voice.ts'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8787)
const DATA_DIR = resolve(process.env.DATA_DIR ?? join(here, '../data'))
const UPLOADS_DIR = join(DATA_DIR, 'uploads')
const CLIENT_DIST = resolve(here, '../../client/dist')

function createProvider(): LLMProvider {
	const key = process.env.XAI_API_KEY
	if (!key || process.env.AGENT_PROVIDER === 'mock') {
		console.warn('[server] XAI_API_KEY not set: using the scripted mock agent.')
		return new MockProvider()
	}
	return new GrokProvider(key, process.env.XAI_MODEL ?? 'grok-4.7', process.env.XAI_BASE_URL)
}

const voice =
	process.env.XAI_API_KEY && process.env.VOICE !== 'browser'
		? new VoiceService(process.env.XAI_API_KEY, process.env.XAI_BASE_URL, process.env.XAI_VOICE ?? 'ara')
		: null

const provider = createProvider()
const rooms = new RoomManager(process.env.PERSIST === 'false' ? null : join(DATA_DIR, 'rooms'))
const agents = new Map<string, AgentSession>()
mkdirSync(UPLOADS_DIR, { recursive: true })

function agentFor(roomId: string) {
	let agent = agents.get(roomId)
	if (!agent) {
		agent = new AgentSession(rooms.get(roomId), provider, { idleMs: Number(process.env.IDLE_MS ?? 4000) }, voice)
		agents.set(roomId, agent)
	}
	return agent
}

const MIME: Record<string, string> = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff2': 'font/woff2',
	'.json': 'application/json',
}

async function handleHttp(req: IncomingMessage, res: ServerResponse) {
	const url = new URL(req.url ?? '/', 'http://localhost')

	// Asset store for images/videos dropped onto the board.
	const upload = url.pathname.match(/^\/api\/uploads\/([a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,199})$/)
	if (upload) {
		const file = join(UPLOADS_DIR, upload[1])
		if (req.method === 'PUT' || req.method === 'POST') {
			const chunks: Buffer[] = []
			let size = 0
			for await (const chunk of req) {
				size += chunk.length
				if (size > 20 * 1024 * 1024) return res.writeHead(413).end()
				chunks.push(chunk)
			}
			await writeFile(file, Buffer.concat(chunks))
			return res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
		}
		if (!existsSync(file)) return res.writeHead(404).end()
		res.writeHead(200, { 'cache-control': 'public, max-age=31536000, immutable' })
		return createReadStream(file).pipe(res)
	}

	// Grok voice: synthesized lines out, recorded utterances in.
	const tts = url.pathname.match(/^\/api\/tts\/([a-zA-Z0-9_-]{1,140})$/)
	if (tts && req.method === 'GET') {
		if (!voice) return res.writeHead(404).end()
		return voice.serve(tts[1], res)
	}
	if (url.pathname === '/api/stt' && req.method === 'POST') {
		if (!voice) return res.writeHead(404).end()
		return voice.transcribe(req, res)
	}

	if (url.pathname === '/api/health') {
		return res
			.writeHead(200, { 'content-type': 'application/json' })
			.end(JSON.stringify({ ok: true, provider: provider.name, voice: voice ? `grok:${voice.voiceId}` : 'browser' }))
	}

	// Serve the built client in production.
	if (existsSync(CLIENT_DIST)) {
		let file = join(CLIENT_DIST, url.pathname)
		if (!file.startsWith(CLIENT_DIST) || !existsSync(file) || statSync(file).isDirectory()) {
			file = join(CLIENT_DIST, 'index.html')
		}
		res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
		return createReadStream(file).pipe(res)
	}
	res.writeHead(404).end('Client not built. Run `npm run dev` and open the Vite URL.')
}

const server = createServer((req, res) => {
	handleHttp(req, res).catch((err) => {
		console.error(err)
		if (!res.headersSent) res.writeHead(500)
		res.end()
	})
})

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
	const url = new URL(req.url ?? '/', 'http://localhost')
	const m = url.pathname.match(/^\/(sync|agent)\/([^/]+)$/)
	if (!m || !RoomManager.isValidId(m[2])) return socket.destroy()
	const [, kind, roomId] = m
	wss.handleUpgrade(req, socket, head, (ws) => {
		if (kind === 'sync') {
			const sessionId = url.searchParams.get('sessionId')
			if (!sessionId) return ws.close()
			rooms.get(roomId).socketRoom.handleSocketConnect({ sessionId, socket: ws as any })
		} else {
			agentFor(roomId).addClient(ws)
		}
	})
})

server.listen(PORT, () => {
	console.log(`[server] listening on http://localhost:${PORT} (agent: ${provider.name}, voice: ${voice ? `grok:${voice.voiceId}` : 'browser'})`)
})
