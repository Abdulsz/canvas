// Live voice against xAI's REAL speech-to-speech API (wss://api.x.ai/v1/realtime).
// A fake microphone asks for a login screen (question.wav); checks the browser gets a
// client secret, connects, streams audio, hears Grok, and Grok's function calls build a screen.
// Requires the server with XAI_API_KEY and no REALTIME_URL. Usage: node e2e/realtime-live.mjs
// Behind an HTTPS proxy (HTTPS_PROXY), Chromium is pointed at it.
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:8787'
const wav = fileURLToPath(new URL('./question.wav', import.meta.url))
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy
const browser = await chromium.launch({
	...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
	...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1' } } : {}),
	args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`, '--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] })
await ctx.addInitScript(() => {
	try {
		localStorage.setItem('grok-whiteboard:identity', JSON.stringify({ userId: 'alice', name: 'Alice', color: '#ff375f' }))
		localStorage.setItem('grok-design:tab', 'agent')
	} catch {}
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
const t0 = Date.now()
const mark = (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${m}`)
const seen = new Map()
let micOn = 0
page.on('websocket', (ws) => {
	if (!ws.url().includes('/realtime')) return
	mark(`WebSocket opened: ${ws.url()}`)
	ws.on('close', () => mark('WebSocket closed'))
	ws.on('socketerror', (e) => mark(`WebSocket error: ${e}`))
	ws.on('framereceived', (f) => {
		let ev
		try {
			ev = JSON.parse(f.payload)
		} catch {
			return
		}
		if (!seen.has(ev.type)) {
			seen.set(ev.type, Date.now())
			if (!/delta$/.test(ev.type) || ev.type === 'response.output_audio.delta') mark(`← ${ev.type}${micOn ? ` (+${((Date.now() - micOn) / 1000).toFixed(1)}s after mic on)` : ''}`)
		}
		if (ev.type === 'error') mark(`  error: ${JSON.stringify(ev.error ?? ev).slice(0, 300)}`)
		if (ev.type === 'conversation.item.input_audio_transcription.completed') mark(`  heard: ${JSON.stringify(ev.transcript)}`)
		if (ev.type === 'response.output_audio_transcript.done') mark(`  Grok said: ${JSON.stringify(ev.transcript)}`)
		if (ev.type === 'response.function_call_arguments.done') mark(`  function call: ${ev.name} ${String(ev.arguments).slice(0, 100)}`)
	})
})

await page.goto(`${BASE}/r/rtlive${Date.now().toString(36)}`)
await page.getByTestId('agent-activity').getByText('Ready').waitFor()
await page.getByRole('switch', { name: 'Live voice' }).click()
await page.getByTestId('voice-dock-mic').click()
micOn = Date.now()
mark('live voice on, mic open (question plays after 2.5s of silence)')
const built = await page
	.waitForFunction(() => window.__editor.getCurrentPageShapes().some((s) => s.type === 'ui' && s.props.kind === 'screen' && s.meta?.author?.kind === 'agent'), null, { timeout: 90000 })
	.then(() => true)
	.catch(() => false)
mark(built ? 'Grok built a screen through realtime function calls' : 'no screen after 90s')
await page.waitForTimeout(8000)
const nodes = await page.evaluate(() => window.__editor.getCurrentPageShapes().filter((s) => s.type === 'ui' && s.meta?.author?.kind === 'agent').length)
await page.keyboard.press('Shift+1').catch(() => {})
await page.waitForTimeout(800)
await page.screenshot({ path: `${process.env.OUT_DIR ?? '.'}/realtime-live.png` })
console.log('\nChat:\n' + (await page.getByTestId('agent-log').innerText()))
const audioAt = seen.get('response.output_audio.delta')
const checks = [
	['WebSocket session established (session.updated)', seen.has('session.updated') || seen.has('session.created')],
	['Grok heard the question (transcription)', seen.has('conversation.item.input_audio_transcription.completed') || seen.has('input_audio_buffer.speech_stopped')],
	[`Grok's voice streamed back${audioAt && micOn ? ` (${((audioAt - micOn) / 1000 - 6).toFixed(1)}s after the question ended)` : ''}`, !!audioAt],
	[`function calls built a screen (${nodes} nodes)`, built && nodes >= 5],
]
for (const [label, ok] of checks) console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
if (errors.length) console.log('page errors:', errors)
await browser.close()
process.exit(checks.every(([, ok]) => ok) ? 0 : 1)
