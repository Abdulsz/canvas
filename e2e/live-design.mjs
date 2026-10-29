// Live multi-turn design conversation against real Grok (typed turns, one session),
// then a Critique. Asserts loosely on the canvas after each turn, checks the layout
// for overflow and overlaps, records latency and screenshots every step.
// Requires the server to run with XAI_API_KEY. Usage: node e2e/live-design.mjs (OUT_DIR for screenshots)
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:8787'
const out = process.env.OUT_DIR ?? '.'
const TURN = 240000
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => {
	try {
		localStorage.setItem('grok-whiteboard:identity', JSON.stringify({ userId: 'alice', name: 'Alice', color: '#ff375f' }))
		localStorage.setItem('grok-design:tab', 'agent')
	} catch {}
	// When each spoken line starts playing (Grok TTS audio).
	window.__audioStarts = []
	const play = HTMLMediaElement.prototype.play
	HTMLMediaElement.prototype.play = function () {
		this.addEventListener('playing', () => window.__audioStarts.push({ t: Date.now(), src: this.src }), { once: true })
		return play.call(this)
	}
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`${BASE}/r/live${Date.now().toString(36)}`)
await page.getByTestId('agent-activity').getByText('Ready').waitFor()
const health = await (await page.request.get(`${BASE}/api/health`)).json()
console.log('server:', JSON.stringify(health))
if (!/^xai:/.test(health.provider)) console.log('warning: the server runs the mock agent, not Grok')

// Timestamp of the latest design change (any ui shape or arrow created/updated).
await page.evaluate(() => {
	window.__changes = []
	window.__editor.store.listen(
		({ changes }) => {
			const touched = [...Object.values(changes.added), ...Object.values(changes.updated).map(([, to]) => to)]
			if (touched.some((r) => r.typeName === 'shape' && (r.type === 'ui' || r.type === 'arrow' || r.type === 'note'))) window.__changes.push(Date.now())
		},
		{ source: 'all', scope: 'document' }
	)
})

const agentBubbles = () => page.locator('[data-testid=agent-log] .bg-\\[var\\(--bubble-agent\\)\\]').count()
const latencies = []
const failures = []
const check = (ok, label) => {
	console.log(`  ${ok ? '✓' : '✗'} ${label}`)
	if (!ok) failures.push(label)
}

/** Sends a typed turn (or presses Critique) and waits for the agent to finish; returns latencies. */
async function turn(label, action) {
	const bubbles = await agentBubbles()
	const audio = await page.evaluate(() => window.__audioStarts.length)
	const t0 = Date.now()
	await action()
	await page.getByTestId('agent-activity').getByText('Ready').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
	// First agent text bubble (the cached ack is ephemeral, so this is Grok's first real line).
	const firstText = page
		.waitForFunction((n) => document.querySelectorAll('[data-testid=agent-log] .bg-\\[var\\(--bubble-agent\\)\\]').length > n, bubbles, { timeout: TURN })
		.then(() => Date.now())
		.catch(() => null)
	await page.getByTestId('agent-activity').getByText('Ready').waitFor({ timeout: TURN })
	const done = Date.now()
	const r = await page.evaluate(([t0, audio]) => ({ audio: window.__audioStarts.slice(audio).map((a) => a.t), change: window.__changes.find((t) => t >= t0) ?? null }), [t0, audio])
	const text = await firstText
	const fmt = (t) => (t ? `${((t - t0) / 1000).toFixed(1)}s` : 'n/a')
	// Audio: the first entry is usually the cached "Sure." ack; the second is Grok's own voice.
	const lat = { label, firstAudio: fmt(r.audio[0]), grokVoice: fmt(r.audio[1] ?? null), firstText: fmt(text), canvas: fmt(r.change), done: fmt(done) }
	latencies.push(lat)
	console.log(`\n▶ ${label}\n  ack audio ${lat.firstAudio} · Grok voice ${lat.grokVoice} · first agent line ${lat.firstText} · first canvas change ${lat.canvas} · turn done ${lat.done}`)
}

async function say(text) {
	await turn(text, async () => {
		await page.getByLabel('Message Grok Design').fill(text)
		await page.keyboard.press('Enter')
	})
}

/** Canvas summary plus layout problems: nodes sticking out of their parent, overlapping auto-layout siblings, empty screens. */
const inspect = () =>
	page.evaluate(() => {
		const e = window.__editor
		const shapes = e.getCurrentPageShapes()
		const screens = shapes.filter((s) => s.type === 'ui' && s.props.kind === 'screen')
		const problems = []
		const nodes = shapes.filter((s) => s.type === 'ui' && s.props.kind !== 'screen')
		for (const n of nodes) {
			const p = e.getShape(n.parentId)
			if (!p || p.type !== 'ui') continue
			const b = e.getShapePageBounds(n)
			const pb = e.getShapePageBounds(p)
			if (b.x < pb.x - 1 || b.y < pb.y - 1 || b.maxX > pb.maxX + 1 || b.maxY > pb.maxY + 1) problems.push(`${n.id.slice(6)} sticks out of ${p.id.slice(6)}`)
			if (n.props.w < 1 && n.props.kind !== 'divider') problems.push(`${n.id.slice(6)} has zero width`)
		}
		for (const p of shapes.filter((s) => s.type === 'ui')) {
			if ((p.meta?.layout?.mode ?? 'none') === 'none') continue
			const kids = e.getSortedChildIdsForParent(p.id).map((id) => e.getShapePageBounds(id))
			for (let i = 0; i < kids.length; i++)
				for (let j = i + 1; j < kids.length; j++) {
					const a = kids[i]
					const b = kids[j]
					if (a.x < b.maxX - 1 && b.x < a.maxX - 1 && a.y < b.maxY - 1 && b.y < a.maxY - 1) problems.push(`children of ${p.id.slice(6)} overlap`)
				}
		}
		for (const s of screens) if (!e.getSortedChildIdsForParent(s.id).length) problems.push(`screen ${s.id.slice(6)} is empty`)
		const resolve = (s, c) => {
			let scr = s
			while (scr && !(scr.type === 'ui' && scr.props.kind === 'screen')) scr = e.getShape(scr.parentId)
			return c === '$primary' ? (scr?.meta?.theme?.primary ?? '#4f46e5') : c
		}
		const buttons = nodes.filter((n) => n.props.kind === 'button').map((n) => ({ id: n.id.slice(6), text: n.props.text, fill: n.props.fill, resolved: resolve(n, n.props.fill) }))
		const arrows = shapes
			.filter((s) => s.type === 'arrow' && s.meta?.role !== 'annotation')
			.map((s) => Object.fromEntries(e.getBindingsFromShape(s, 'arrow').map((b) => [b.props.terminal, b.toId.slice(6)])))
		return {
			screens: screens.map((s) => ({ id: s.id.slice(6), name: s.props.name, theme: s.meta?.theme, nodes: e.getShapeAndDescendantIds([s.id]).size - 1 })),
			buttons,
			toggles: nodes.filter((n) => n.props.kind === 'toggle' || (n.props.kind === 'checkbox' && /remember/i.test(n.props.text))).map((n) => n.id.slice(6)),
			texts: nodes.filter((n) => n.props.kind === 'text').map((n) => n.props.text),
			arrows,
			comments: shapes.filter((s) => s.type === 'note' && s.meta?.role === 'comment').length,
			highlights: shapes.filter((s) => s.meta?.role === 'annotation' && s.meta?.targets?.length).length,
			problems: [...new Set(problems)].slice(0, 12),
			// Hard-coded colors don't follow the theme (dark mode); tokens do.
			hex: nodes.flatMap((n) => ['fill', 'textColor', 'stroke'].filter((k) => /^#/.test(n.props[k] ?? '')).map((k) => `${n.id.slice(6)}.${k}=${n.props[k]}`)),
		}
	})

async function shot(name) {
	// The app's zoom to fit (Shift+1) leaves room for the voice dock; wait for the agent cursor to fade.
	await page.evaluate(() => document.activeElement?.blur())
	await page.keyboard.press('Shift+1')
	await page.waitForFunction(() => document.querySelector('[data-testid=agent-cursor]')?.dataset.visible !== 'true', null, { timeout: 10000 }).catch(() => {})
	await page.waitForTimeout(900)
	await page.screenshot({ path: `${out}/live-${name}.png` })
	console.log(`  screenshot ${out}/live-${name}.png`)
}

const brownish = (hex) => {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
	if (!m) return false
	const n = parseInt(m[1], 16)
	const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255]
	return r > g && g >= b - 10 && r < 220 && r - b > 30
}

// ---------------------------------------------------------------- 1: login
await say('Design a login screen for a coffee shop app')
let s = await inspect()
check(s.screens.length >= 1 && s.screens[0].nodes >= 6, `a login screen with ${s.screens[0]?.nodes ?? 0} nodes`)
check(s.buttons.some((b) => /sign|log/i.test(b.text ?? '')), `a sign-in button (${s.buttons.map((b) => b.text).join(', ')})`)
check(!s.problems.length, `layout clean ${s.problems.join('; ')}`)
await shot('1-login')
const signIn = () => s.buttons.find((b) => /sign ?in|log ?in/i.test(b.text ?? '')) ?? s.buttons[0]
const before = signIn()

// ---------------------------------------------------------------- 2: restyle
await say('make the sign in button brown')
s = await inspect()
const after = signIn()
check(after && brownish(after.resolved) && (after.fill !== before?.fill || after.resolved !== before?.resolved || brownish(before?.resolved)), `sign-in button is brown (${after?.fill} → ${after?.resolved})`)
check(!s.problems.length, `layout clean ${s.problems.join('; ')}`)
await shot('2-brown')

// ---------------------------------------------------------------- 3: toggle
await say('add a remember me toggle')
s = await inspect()
check(s.toggles.length > 0, `remember-me toggle (${s.toggles.join(', ')})`)
check(!s.problems.length, `layout clean ${s.problems.join('; ')}`)
await shot('3-toggle')

// ---------------------------------------------------------------- 4: dark mode
await say('switch to dark mode')
s = await inspect()
check(s.screens.every((x) => x.theme?.mode === 'dark'), `dark theme (${s.screens.map((x) => x.theme?.mode).join(', ')})`)
console.log(`  hard-coded colors: ${s.hex.join(', ') || 'none'}`)
await shot('4-dark')

// ---------------------------------------------------------------- 5: menu + flow
await say('add a menu screen with a list of drinks and connect sign in to it')
s = await inspect()
const menu = s.screens.find((x) => /menu|drink/i.test(`${x.id} ${x.name}`))
check(s.screens.length >= 2 && !!menu, `menu screen (${s.screens.map((x) => x.name).join(', ')})`)
check(!!menu && menu.nodes >= 8, `menu has a drinks list (${menu?.nodes} nodes)`)
check(menu?.theme?.mode === 'dark', 'menu screen is dark too')
check(s.arrows.some((a) => a.end === menu?.id), `flow arrow into the menu (${JSON.stringify(s.arrows)})`)
check(!s.problems.length, `layout clean ${s.problems.join('; ')}`)
await shot('5-menu')

// ---------------------------------------------------------------- 6: critique
await turn('Critique', () => page.getByRole('button', { name: 'Critique', exact: true }).click())
s = await inspect()
check(s.comments > 0, `${s.comments} comment(s) on the canvas`)
check(s.highlights > 0, `${s.highlights} highlight(s)`)
await shot('6-critique')

console.log('\nLatency (from sending the turn):')
console.table(latencies)
console.log('\nConversation:\n' + (await page.getByTestId('agent-log').innerText()))
if (errors.length) console.log('page errors:', errors)
await browser.close()
if (failures.length || errors.length) {
	console.log(`\nFAIL: ${failures.length} check(s) failed`)
	process.exit(1)
}
console.log('\nPASS')
