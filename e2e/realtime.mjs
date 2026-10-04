// Live voice (speech-to-speech) client test against a local fake of xAI's realtime API.
// Start the app server with REALTIME_URL=ws://localhost:8790 and XAI_API_KEY set (look_at_board
// uses the real vision model through /api/describe), then: node e2e/realtime.mjs
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startFakeRealtime } from './fake-realtime.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:8787'
const wav = fileURLToPath(new URL('./question.wav', import.meta.url))
const fake = startFakeRealtime({ port: Number(process.env.FAKE_REALTIME_PORT ?? 8790) })
const browser = await chromium.launch({
	...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
	args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`, '--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] })
await ctx.addInitScript(() => localStorage.setItem('grok-whiteboard:identity', JSON.stringify({ userId: 'alice', name: 'Alice', color: '#ff375f' })))
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const t0 = Date.now()
const mark = (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${m}`)
const fail = async (msg) => {
	console.log('FAIL:', msg, '\nfake server log:', JSON.stringify({ ...fake.log, events: fake.log.events.map((e) => e.type).filter((t) => t !== 'input_audio_buffer.append') }, null, 1).slice(0, 3000))
	await browser.close()
	fake.close()
	process.exit(1)
}

await page.goto(`${BASE}/r/live${Date.now().toString(36)}`)
await page.getByTestId('agent-activity').getByText('Ready').waitFor()
await page.getByRole('switch', { name: 'Live voice' }).click()
await page.getByRole('button', { name: 'Talk to Grok' }).click()
await page.getByTestId('agent-activity').getByText(/Live · /).waitFor()
mark('live voice on')

await page.waitForFunction(() => window.__editor.getCurrentPageShapes().filter((s) => s.meta?.author?.kind === 'agent').length >= 3, null, { timeout: 30000 }).catch(() => fail('agent did not draw'))
mark('agent drew client, load balancer and arrow from realtime function calls')
const deadline = Date.now() + 60000
while (!fake.log.truncate && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250))
if (!fake.log.truncate) await fail('no truncate after barge-in')
mark('barge-in handled: client stopped playback and sent conversation.item.truncate')

const L = fake.log
const s = L.session ?? {}
const checks = [
	['browser authenticated with the xai-client-secret subprotocol', L.protocolOk],
	['session.update: server VAD, PCM 24 kHz in and out', s.turn_detection?.type === 'server_vad' && s.audio?.input?.format?.rate === 24000 && s.audio?.output?.format?.type === 'audio/pcm'],
	[`session.update: ${s.tools?.length} function tools incl. look_at_board`, s.tools?.some((t) => t.type === 'function' && t.name === 'look_at_board') && !s.tools?.some((t) => t.name === 'get_canvas_image')],
	[`mic streamed ${(L.appendedBytes / 48000).toFixed(1)}s of 24 kHz PCM16 audio`, L.appendedBytes > 48000 * 3],
	['3 drawing outputs returned ok', L.outputs.filter((o) => o.call_id.startsWith('call_1_')).every((o) => o.output.ok) && L.outputs.filter((o) => o.call_id.startsWith('call_1_')).length === 3],
	['response.create sent only after all outputs', L.timings.outputsPendingAtCreate2 === 0 && L.timings.outputsPendingAtCreate3 === 0],
	[`response.create waited for playback (${L.timings.create2 - L.timings.response1Done}ms after 1500ms of audio)`, L.timings.create2 - L.timings.response1Done >= 1300],
	['truncate reports less audio heard than was sent', L.truncate.audio_end_ms > 0 && L.truncate.audio_end_ms < 6000],
]
const look = L.outputs.find((o) => o.call_id === 'call_2_0')?.output
checks.push([`look_at_board described the board via the vision model: ${JSON.stringify(look?.description ?? look?.error ?? '').slice(0, 160)}`, look?.ok && /balanc/i.test(look.description ?? '')])
const transcript = await page.getByTestId('agent-log').innerText()
checks.push(['chat shows the student transcript and the agent transcript', transcript.includes('explain how a load balancer works') && transcript.includes('A load balancer spreads requests')])
for (const [label, ok] of checks) console.log(`${ok ? '  ✓' : '  ✗'} ${label}`)
await page.evaluate(() => { window.__editor.zoomToFit() })
await page.waitForTimeout(500)
await page.screenshot({ path: `${process.env.OUT_DIR ?? '.'}/realtime.png` })
await browser.close()
fake.close()
if (errors.length) console.log('page errors:', errors)
if (checks.some(([, ok]) => !ok) || errors.length) process.exit(1)
console.log('PASS')
