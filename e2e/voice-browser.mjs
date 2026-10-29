// Offline voice test: the browser-voice fallback (server without Grok voice, or VOICE=browser).
// Headless Chromium has no working speech recognition or voices, so the Web Speech API is
// replaced with a scripted stand-in: "recognition" delivers the phrases this test speaks,
// and "synthesis" records what the agent says and finishes each line after a short delay.
// Everything else is the real app: the dock mic, the hands-free loop, barge-in, captions,
// and the mock agent designing on the canvas.
// Usage: start the server without an API key (`npm run build && npm start`), then `node e2e/voice-browser.mjs`.
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:8787'
const out = process.env.OUT_DIR ?? '.'
const wav = fileURLToPath(new URL('./question.wav', import.meta.url))
const browser = await chromium.launch({
	...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
	args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] })
await ctx.addInitScript(() => {
	try {
		localStorage.setItem('grok-whiteboard:identity', JSON.stringify({ userId: 'vera', name: 'Vera', color: '#2f9e44' }))
		localStorage.setItem('grok-design:tab', 'design')
	} catch {}
	const voice = (window.__voice = { recognizers: [], spoken: [], cancelled: 0, active: null })
	class FakeRecognition {
		constructor() {
			this.continuous = false
			this.interimResults = false
			this.lang = 'en-US'
			voice.recognizers.push(this)
		}
		start() {
			voice.active = this
		}
		stop() {
			if (voice.active === this) voice.active = null
			setTimeout(() => this.onend?.(), 0)
		}
		abort() {
			this.stop()
		}
	}
	window.SpeechRecognition = window.webkitSpeechRecognition = FakeRecognition
	/** The test "speaks": speech start, then a final transcript after `ms`. */
	window.__speak = (text, ms = 400) => {
		const rec = voice.active
		if (!rec) return false
		rec.onspeechstart?.()
		setTimeout(() => {
			const alt = { transcript: text, confidence: 0.95 }
			const result = Object.assign([alt], { isFinal: true })
			rec.onresult?.({ resultIndex: 0, results: [result] })
		}, ms)
		return true
	}
	// Speech synthesis: lines "play" for 120 ms per word, so the speaking state is observable.
	let current = null
	const synth = {
		speaking: false,
		speak(u) {
			voice.spoken.push(u.text)
			current = u
			this.speaking = true
			u.timer = setTimeout(() => {
				this.speaking = false
				current = null
				u.onend?.()
			}, 300 + u.text.split(/\s+/).length * 120)
		},
		cancel() {
			voice.cancelled++
			if (current) {
				clearTimeout(current.timer)
				const u = current
				current = null
				this.speaking = false
				u.onend?.()
			}
		},
		getVoices: () => [],
		addEventListener() {},
	}
	Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true })
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const step = (m) => console.log(`• ${m}`)
const fail = (m) => {
	throw new Error(m)
}

const health = await (await fetch(`${BASE}/api/health`)).json()
if (health.voice !== 'browser') fail(`server must run without Grok voice (VOICE=browser or no XAI_API_KEY); /api/health says ${JSON.stringify(health)}`)
await page.goto(`${BASE}/r/voice${Date.now().toString(36)}`)
await page.getByTestId('agent-status-strip').getByText('Ready').waitFor()

// 1. Mic toggles the hands-free conversation.
const mic = page.getByTestId('voice-dock-mic')
await mic.click()
await page.waitForFunction(() => document.querySelector('[data-testid=voice-dock-mic]')?.getAttribute('aria-pressed') === 'true')
await page.getByTestId('voice-caption').getByText('Listening — describe a screen or an edit').waitFor()
if (!(await page.evaluate(() => window.__voice.active?.continuous))) fail('browser recognition did not start in continuous mode')
step('dock mic on: browser speech recognition listening (continuous), dock caption "Listening…"')

// 2. Say a request: the agent designs, and its lines are spoken + captioned in the dock.
await page.evaluate(() => window.__speak('Design a login screen'))
await page.waitForFunction(() => window.__editor.getShape('shape:login')?.props.kind === 'screen', null, { timeout: 60000 })
await page.getByTestId('voice-caption').getByText(/clean mobile login|social sign-in|sign-up screen/).first().waitFor({ timeout: 30000 })
const captionWhileSpeaking = await page.getByTestId('voice-caption').innerText()
step(`spoke "Design a login screen" → agent built the Login screen; dock caption: "${captionWhileSpeaking}"`)
await page.getByTestId('agent-status-strip').getByText('Ready').waitFor({ timeout: 60000 })
const spoken = await page.evaluate(() => window.__voice.spoken)
if (!spoken.some((t) => /login/i.test(t))) fail('agent lines were not spoken with browser speech synthesis: ' + JSON.stringify(spoken))
if ((await mic.getAttribute('aria-pressed')) !== 'true') fail('mic closed after the turn; the conversation should stay hands-free')
step(`agent's ${spoken.length} lines went to browser speech synthesis; mic stayed open`)

// 3. Barge-in + follow-up by voice in the same conversation.
await page.evaluate(() => window.__speak('make the button green', 200))
await page.waitForFunction(() => window.__editor.getShape('shape:login_primary_btn')?.props.fill === '#16a34a', null, { timeout: 60000 })
await page.getByTestId('agent-status-strip').getByText('Ready').waitFor({ timeout: 60000 })
// Talk over the agent while it speaks: its voice stops right away.
await page.evaluate(() => window.__speak('switch to dark mode', 600))
await page.waitForFunction(() => window.speechSynthesis.speaking || window.__voice.spoken.length > 0)
await page.waitForFunction(() => window.__editor.getShape('shape:login')?.meta.theme?.mode === 'dark', null, { timeout: 60000 })
// The agent's first line of that turn is still playing: interrupt it.
await page.waitForFunction(() => window.speechSynthesis.speaking, null, { timeout: 10000 })
const cancelledBefore = await page.evaluate(() => window.__voice.cancelled)
await page.evaluate(() => window.__voice.active?.onspeechstart?.())
await page.waitForFunction((n) => window.__voice.cancelled > n && !window.speechSynthesis.speaking, cancelledBefore, { timeout: 5000 }).catch(() => fail('talking over the agent did not stop its voice'))
step('voice follow-ups "make the button green" and "switch to dark mode" applied; talking over the agent cut its voice off')

// 4. Mic off.
await page.getByTestId('agent-status-strip').getByText('Ready').waitFor({ timeout: 60000 })
await mic.click()
await page.waitForFunction(() => document.querySelector('[data-testid=voice-dock-mic]')?.getAttribute('aria-pressed') === 'false')
if (await page.evaluate(() => window.__voice.active)) fail('recognition still running after the mic was turned off')
step('dock mic off: recognition stopped')

const log = await page.evaluate(() => {
	document.querySelector('[role=tab][aria-selected=false]')?.click()
	return document.querySelector('[data-testid=agent-log]').innerText
})
for (const line of ['Design a login screen', 'make the button green', 'switch to dark mode']) if (!log.includes(line)) fail(`log missing "${line}"`)
await page.screenshot({ path: `${out}/voice-browser.png` })
await browser.close()
if (errors.length) {
	console.log('page errors:\n' + errors.join('\n'))
	process.exit(1)
}
console.log('PASS')
