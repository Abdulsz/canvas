// End-to-end check: two students + the (mock) agent on one board.
// Usage: start the server (`npm start`, after `npm run build`), then `node e2e/collab.mjs`.
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:8787'
const room = `e2e${Date.now().toString(36)}`
const out = process.env.OUT_DIR ?? '.'
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const errors = []

async function join(name, color) {
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
	await ctx.addInitScript(
		([name, color]) => localStorage.setItem('grok-whiteboard:identity', JSON.stringify({ userId: name.toLowerCase(), name, color })),
		[name, color]
	)
	const page = await ctx.newPage()
	page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
	page.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`))
	await page.goto(`${BASE}/r/${room}`)
	await page.waitForFunction(() => window.__editor)
	await page.getByTestId('agent-activity').getByText('Ready').waitFor()
	return page
}

const count = (page, pred) => page.evaluate((pred) => window.__editor.getCurrentPageShapes().filter(new Function('s', `return ${pred}`)).length, pred)
const step = (msg) => console.log(`• ${msg}`)

const alice = await join('Alice', '#e03131')
const bob = await join('Bob', '#1971c2')
await alice.getByTestId('participants').getByText('Bob').waitFor()
step('both students joined and see each other')

// 1. Agent teaches: draws a diagram that syncs to everyone.
await alice.getByLabel('Message Professor Grok').fill('Explain a basic web architecture')
await alice.keyboard.press('Enter')
await bob.waitForFunction(() => window.__editor.getCurrentPageShapes().filter((s) => s.meta?.author?.kind === 'agent').length >= 10, null, { timeout: 60000 })
await bob.getByTestId('agent-cursor').waitFor()
await alice.getByTestId('agent-activity').getByText('Ready').waitFor({ timeout: 60000 })
step(`agent drew ${await count(bob, "s.meta?.author?.kind === 'agent'")} shapes, visible to Bob, with agent cursor`)

// 2. Bob draws: a labeled box plus freehand ink.
await bob.evaluate(() => {
	const e = window.__editor
	e.createShape({ type: 'geo', x: 1100, y: 300, props: { w: 180, h: 90, geo: 'rectangle', richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Redis Cache' }] }] } } })
	e.zoomToFit()
	e.setCurrentTool('draw')
})
await bob.mouse.move(700, 600)
await bob.mouse.down()
for (let i = 0; i <= 20; i++) await bob.mouse.move(700 + i * 10, 600 + Math.sin(i / 3) * 30)
await bob.mouse.up()
await alice.waitForFunction(() => window.__editor.getCurrentPageShapes().filter((s) => s.meta?.author?.name === 'Bob').length >= 2)
step('Bob drew a box and freehand ink; Alice sees both, attributed to Bob')

// 3. Bob asks for a review: the agent reads the board and annotates it.
await bob.getByRole('button', { name: /Check my work/ }).click()
await alice.waitForFunction(
	() =>
		window.__editor
			.getCurrentPageShapes()
			.some((s) => s.meta?.role === 'comment' && JSON.stringify(s.props.richText).includes('Redis Cache') && JSON.stringify(s.props.richText).includes('@Bob')),
	null,
	{ timeout: 60000 }
)
await alice.waitForFunction(() => window.__editor.getCurrentPageShapes().some((s) => s.meta?.role === 'annotation' && s.props.color === 'green'))
step('agent reviewed Bob\'s work: comment mentions "Redis Cache" and @Bob, highlight drawn')
await bob.getByTestId('agent-activity').getByText('Ready').waitFor({ timeout: 60000 })
const log = await bob.getByTestId('agent-log').innerText()
if (!/Bob, nice work/.test(log)) throw new Error('agent reply not in log:\n' + log)

// 4. Student work is protected: the agent never authored over Bob's shapes.
const bobShapes = await count(alice, "s.meta?.author?.name === 'Bob'")
if (bobShapes < 2) throw new Error('Bob shapes changed')
step('Bob\'s shapes are intact')

// 5. Algorithm mode: the agent animates two pointers across an array, step by step.
await alice.getByLabel('Message Professor Grok').fill('Show two pointers on an array')
await alice.keyboard.press('Enter')
await bob.waitForFunction(
	() => {
		const e = window.__editor
		const text = (id) => JSON.stringify(e.getShape(id)?.props.richText ?? '')
		return text('shape:arr_ptr_2_label').includes('left') && text('shape:arr_ptr_3_label').includes('right')
	},
	null,
	{ timeout: 90000 }
)
await alice.getByTestId('agent-activity').getByText('Ready').waitFor({ timeout: 60000 })
const stale = await count(bob, "s.id.startsWith('shape:arr_ptr_0') || s.id.startsWith('shape:arr_ptr_5')")
if (stale) throw new Error('old pointer markers were not removed')
step('agent moved left/right pointers to the answer (indices 2 and 3); old markers removed')

await bob.evaluate(() => { window.__editor.zoomToFit() })
await bob.waitForTimeout(500)
await bob.screenshot({ path: `${out}/bob.png` })
await alice.screenshot({ path: `${out}/alice.png` })

await browser.close()
if (errors.length) {
	console.log('Browser errors:\n' + errors.join('\n'))
	process.exit(1)
}
console.log('PASS')
