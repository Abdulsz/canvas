// Live voice test against real Grok: a fake microphone asks for a design out loud
// (question.wav: "Hey, can you design a login screen for my coffee app?").
// Requires the server to run with XAI_API_KEY (Grok voice enabled).
// Usage: npm run build && npm start &  then  node e2e/voice.mjs
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE_URL ?? 'http://localhost:8787'
const wav = fileURLToPath(new URL('./question.wav', import.meta.url))
const out = process.env.OUT_DIR ?? '.'
const browser = await chromium.launch({
	...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
	args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`, '--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] })
await ctx.addInitScript(() => {
	try {
		localStorage.setItem('grok-whiteboard:identity', JSON.stringify({ userId: 'alice', name: 'Alice', color: '#ff375f' }))
		localStorage.setItem('grok-design:tab', 'agent')
	} catch {}
	// Record when each spoken line actually starts and stops playing.
	window.__speech = []
	const play = HTMLMediaElement.prototype.play
	HTMLMediaElement.prototype.play = function () {
		const entry = { src: this.src, start: 0, end: 0 }
		window.__speech.push(entry)
		this.addEventListener('playing', () => (entry.start ||= performance.timeOrigin + performance.now()), { once: true })
		const done = () => (entry.end ||= performance.timeOrigin + performance.now())
		this.addEventListener('ended', done, { once: true })
		this.addEventListener('pause', done, { once: true })
		return play.call(this)
	}
})
const page = await ctx.newPage()
const t0 = Date.now()
const mark = (msg) => console.log(`${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(5)}s  ${msg}`)
page.on('pageerror', (e) => console.log('pageerror', e.message))
page.on('response', async (r) => {
	const u = new URL(r.url())
	if (u.pathname === '/api/stt') mark(`speech-to-text ${r.status()}: ${JSON.stringify((await r.json().catch(() => ({}))).text)}`)
	if (u.pathname.startsWith('/api/tts/')) mark(`Grok voice audio ${r.status()} ${r.headers()['content-type']}`)
})

await page.goto(`${BASE}/r/voice${Date.now().toString(36)}`)
await page.getByTestId('agent-activity').getByText('Ready').waitFor()
const health = await (await page.request.get(`${BASE}/api/health`)).json()
mark(`server: ${JSON.stringify(health)}`)
await page.getByTestId('voice-dock-mic').click()
const micOn = Date.now()
mark('mic on (fake microphone plays the question after 2.5s of silence)')

await page.getByTestId('agent-log').getByText(/log ?in/i).first().waitFor({ timeout: 30000 })
mark('utterance transcribed and sent')
await page.waitForFunction(() => window.__editor.getCurrentPageShapes().some((s) => s.type === 'ui' && s.props.kind === 'screen' && s.meta?.author?.kind === 'agent'), null, { timeout: 60000 })
mark('agent created its first screen')
// The dock captions what the agent is saying.
await page.getByTestId('voice-caption').waitFor({ timeout: 30000 })
mark(`dock caption: ${JSON.stringify(await page.getByTestId('voice-caption').innerText())}`)
await page.waitForFunction(() => document.querySelectorAll('[data-testid=agent-log] .bg-\\[var\\(--bubble-agent\\)\\]').length > 0, null, { timeout: 60000 })
mark(`agent said: ${JSON.stringify((await page.locator('[data-testid=agent-log] .bg-\\[var\\(--bubble-agent\\)\\]').first().innerText()).slice(0, 120))}`)
await page.getByTestId('agent-activity').getByText('Ready').waitFor({ timeout: 180000 })
// Conversational timing: question audio is 2.5s of silence + 3.5s of speech after the mic opens.
const questionEnd = micOn + 6000
const lines = (await page.evaluate(() => window.__speech)).filter((l) => l.start && l.src.includes('/api/tts/'))
if (process.env.TIMELINE) for (const l of lines) console.log(`   ${((l.start - questionEnd) / 1000).toFixed(1)}s → ${((l.end - questionEnd) / 1000).toFixed(1)}s  ${l.src.split('/').pop()}`)
if (lines.length) {
	console.log(`\nTiming: first audio ${((lines[0].start - questionEnd) / 1000).toFixed(1)}s after the user stopped talking`)
	const gaps = lines.slice(1).map((l, i) => (l.start - (lines[i].end || l.start)) / 1000)
	console.log(`Silent gaps between ${lines.length} lines (s): ${gaps.map((g) => g.toFixed(1)).join(', ')}  | longest ${Math.max(0, ...gaps).toFixed(1)}s`)
}
const nodes = await page.evaluate(() => window.__editor.getCurrentPageShapes().filter((s) => s.type === 'ui' && s.meta?.author?.kind === 'agent').length)
mark(`turn finished: ${nodes} design nodes`)
if (nodes < 5) throw new Error('the agent did not build a screen')
await page.evaluate(() => { window.__editor.zoomToFit() })
await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/voice-live.png` })
console.log('\nConversation:\n' + (await page.getByTestId('agent-log').innerText()))
await browser.close()
