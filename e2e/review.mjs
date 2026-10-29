// Live critique test against real Grok: Bob has designed a small screen with a few
// usability problems (tiny caption, a 32px-tall button, low-contrast text), presses
// Critique, and the agent annotates his nodes without changing them.
// Requires the server to run with XAI_API_KEY. Usage: node e2e/review.mjs [outDir]
import { chromium } from 'playwright'
const BASE = process.env.BASE_URL ?? 'http://localhost:8787'
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => {
	try {
		localStorage.setItem('grok-whiteboard:identity', JSON.stringify({ userId: 'bob', name: 'Bob', color: '#0a84ff' }))
		localStorage.setItem('grok-design:tab', 'agent')
	} catch {}
})
const page = await ctx.newPage()
const t0 = Date.now()
const mark = (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${m}`)
await page.goto(`${BASE}/r/review` + Date.now().toString(36))
await page.getByTestId('agent-activity').getByText('Ready').waitFor()

// Bob's screen: built with the design tools, then stamped as Bob's work (as if he made it in the shell).
await page.evaluate(async () => {
	const r = await window.__executor.run('create_screen', {
		id: 'checkout',
		name: 'Checkout',
		device: 'iphone',
		layout: 'vertical',
		padding: [64, 24, 32, 24],
		gap: 16,
		children: [
			{ id: 'checkout_title', type: 'text', text: 'Checkout', fontSize: 28, fontWeight: 700 },
			{ id: 'checkout_card', type: 'input', icon: 'lock', text: 'Card number' },
			{ id: 'checkout_note', type: 'text', text: 'By paying you agree to our terms and the refund policy.', fontSize: 10, textColor: '#c8c8c8' },
			{ id: 'checkout_pay', type: 'button', text: 'Pay $24.00', height: 32 },
		],
	})
	if (!r.ok) throw new Error(r.error)
	const e = window.__editor
	const bob = { kind: 'user', id: 'bob', name: 'Bob' }
	const ids = e.getShapeAndDescendantIds(['shape:checkout'])
	e.updateShapes([...ids].map((id) => ({ id, type: 'ui', meta: { ...e.getShape(id).meta, author: bob, updatedBy: bob } })))
})
const before = await page.evaluate(() => JSON.stringify(window.__editor.getCurrentPageShapes().filter((s) => s.meta?.author?.name === 'Bob').map((s) => [s.id, s.props])))
mark('Bob designed a Checkout screen: tiny low-contrast caption, 32px-tall Pay button')
await page.getByRole('button', { name: 'Critique', exact: true }).click()
await page.getByTestId('agent-activity').getByText('Ready').waitFor({ state: 'hidden' })
await page.getByTestId('agent-activity').getByText('Ready').waitFor({ timeout: 180000 })
mark('critique finished')
const feedback = await page.evaluate(() =>
	window.__editor
		.getCurrentPageShapes()
		.filter((s) => s.meta?.author?.kind === 'agent' && (s.meta.role === 'comment' || s.meta.role === 'annotation'))
		.map((s) => ({ role: s.meta.role, kind: s.meta.kind, targets: s.meta.targets, text: JSON.stringify(s.props.richText ?? '') }))
)
const after = await page.evaluate(() => JSON.stringify(window.__editor.getCurrentPageShapes().filter((s) => s.meta?.author?.name === 'Bob').map((s) => [s.id, s.props])))
console.log('agent feedback:', JSON.stringify(feedback, null, 1))
if (after !== before) throw new Error("Bob's nodes were changed without asking")
const comments = feedback.filter((f) => f.role === 'comment')
if (!comments.length) throw new Error('no comments on the canvas')
if (!comments.some((c) => c.text.includes('@Bob'))) console.log('warning: no comment is addressed to @Bob')
if (!feedback.some((f) => (f.targets ?? []).some((t) => /checkout_(pay|note)/.test(t)))) console.log('warning: the button/caption problems were not highlighted')
await page.evaluate(() => { window.__editor.zoomToFit() })
await page.waitForTimeout(600)
await page.screenshot({ path: `${process.argv[2] ?? '.'}/review-live.png` })
console.log('\n' + (await page.getByTestId('agent-log').innerText()))
await browser.close()
