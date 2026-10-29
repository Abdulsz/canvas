// End-to-end check: two collaborators + the (mock) design agent in one room.
// Usage: start the server without an API key (`npm run build && npm start`), then `node e2e/collab.mjs`.
//
// Alice asks for a login screen, then keeps talking to the agent in the same
// session ("make the button green", "add a toggle", "switch to dark mode", "add a
// signup screen and connect it"). After each turn both browsers must show the
// same canvas. Bob edits a node in the Design panel and asks for a critique; the
// agent annotates his change by name. Finally the agent asks before deleting a
// node Bob made.
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:8787'
const room = `e2e${Date.now().toString(36)}`
const out = process.env.OUT_DIR ?? '.'
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const errors = []
const TURN = 60000

async function join(name, color) {
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
	await ctx.addInitScript(
		([name, color]) => {
			// Init scripts also run in the code preview's sandboxed iframe, which has no storage.
			try {
				localStorage.setItem('grok-whiteboard:identity', JSON.stringify({ userId: name.toLowerCase(), name, color }))
				localStorage.setItem('grok-design:tab', name === 'Alice' ? 'agent' : 'design')
			} catch {}
		},
		[name, color]
	)
	const page = await ctx.newPage()
	page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
	page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${name} console: ${m.text()}`))
	await page.goto(`${BASE}/r/${room}`)
	await page.waitForFunction(() => window.__editor)
	return page
}

const step = (msg) => console.log(`• ${msg}`)
const fail = (msg) => {
	throw new Error(msg)
}
/** Waits until `pred(editor)` holds on every page (pred is serialized, so it must be self-contained). */
async function onBoth(pred, arg, what) {
	for (const [who, page] of [['Alice', alice], ['Bob', bob]]) {
		await page.waitForFunction(pred, arg, { timeout: TURN }).catch(() => fail(`${who} never saw: ${what}`))
	}
}
const ui = (page, id) => page.evaluate((id) => { const s = window.__editor.getShape(`shape:${id}`); return s ? { props: s.props, meta: s.meta, parentId: s.parentId } : null }, id)
const ready = (page) => page.getByTestId('agent-status-strip').or(page.getByTestId('agent-activity')).getByText('Ready').first().waitFor({ timeout: TURN })

async function ask(text) {
	const before = await alice.getByTestId('agent-log').locator(':scope > div').count()
	await alice.getByLabel('Message Grok Design').fill(text)
	await alice.keyboard.press('Enter')
	// Wait for the agent to pick the turn up, then to finish it.
	await alice.waitForFunction((n) => document.querySelectorAll('[data-testid=agent-log] > div').length > n, before)
	await alice.getByTestId('agent-activity').getByText('Ready').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
	await ready(alice)
	await ready(bob)
}

const alice = await join('Alice', '#e03131')
const bob = await join('Bob', '#1971c2')
await alice.getByTestId('agent-activity').getByText('Ready').waitFor()
await bob.getByTestId('agent-status-strip').getByText('Ready').waitFor()
await alice.waitForFunction(() => document.querySelector('[data-testid=top-participants]')?.getAttribute('title')?.includes('Bob'))
step('Alice and Bob joined the room and see each other')

// ------------------------------------------------------------------ turn 1: build
await ask('Design a login screen')
await onBoth(
	() => {
		const e = window.__editor
		const s = e.getShape('shape:login')
		const kids = e.getCurrentPageShapes().filter((x) => x.type === 'ui' && x.props.kind !== 'screen')
		return s?.type === 'ui' && s.props.kind === 'screen' && s.meta.author?.kind === 'agent' && kids.length > 15 && !!e.getShape('shape:login_google_btn')
	},
	null,
	'login screen with social buttons'
)
await bob.getByTestId('layers-panel').getByText('Login', { exact: true }).waitFor()
await alice.getByTestId('layers-panel').getByText('Login', { exact: true }).waitFor()
// The agent's cursor showed up for Bob while it worked, and leaves once the agent is idle.
await bob.waitForFunction(() => document.querySelector('[data-testid=agent-cursor]'))
await bob.waitForFunction(() => document.querySelector('[data-testid=agent-cursor]')?.dataset.visible === 'false', null, { timeout: 8000 }).catch(() => fail('agent cursor stayed on the canvas after the agent went idle'))
// The zoom-to-fit after building leaves the bottom of the screen above the voice dock.
const fit = await alice.evaluate(() => {
	const e = window.__editor
	const b = e.getShapePageBounds('shape:login')
	const bottom = e.pageToScreen({ x: b.x, y: b.maxY }).y
	const top = e.pageToScreen({ x: b.x, y: b.y }).y
	const dock = document.querySelector('[data-testid=voice-dock] > div').getBoundingClientRect()
	return { bottom, top, dockTop: dock.top }
})
if (fit.bottom > fit.dockTop) fail(`zoom-to-fit put the screen bottom (${fit.bottom}) under the voice dock (${fit.dockTop})`)
step(`agent built the login screen; both see it and its layers; agent cursor hid when idle; screen fits above the dock (${Math.round(fit.dockTop - fit.bottom)}px clear)`)

// ------------------------------------------------------------------ turn 2: restyle
await ask('make the button green')
await onBoth(() => window.__editor.getShape('shape:login_primary_btn')?.props.fill === '#15803d', null, 'green primary button')
step('turn 2: "make the button green" → login_primary_btn fill #15803d on both')

// ------------------------------------------------------------------ turn 3: add a component
await ask('add a toggle')
await onBoth(
	() => {
		const e = window.__editor
		const t = e.getCurrentPageShapes().find((s) => s.type === 'ui' && s.props.kind === 'toggle')
		if (!t) return false
		let p = e.getShape(t.parentId)
		while (p && p.parentId && p.id !== 'shape:login') p = e.getShape(p.parentId)
		return p?.id === 'shape:login' && t.props.checked === true
	},
	null,
	'a toggle inside the login screen'
)
step('turn 3: "add a toggle" → toggle row added inside the login screen')

// ------------------------------------------------------------------ turn 4: theme
await ask('switch to dark mode')
await onBoth(() => window.__editor.getShape('shape:login')?.meta.theme?.mode === 'dark', null, 'login in dark mode')
step('turn 4: "switch to dark mode" → login meta.theme.mode = dark')

// A 1:1 PNG export of the dark screen paints its own dark background (tldraw skips a lone frame's
// own fill when exporting it, which used to give white or black behind the light text).
const exportPixels = await alice.evaluate(async () => {
	const { blob } = await window.__editor.toImage(['shape:login'], { format: 'png', scale: 1, pixelRatio: 1, background: true, padding: 0 })
	const bmp = await createImageBitmap(blob)
	const c = new OffscreenCanvas(bmp.width, bmp.height)
	const g = c.getContext('2d')
	g.drawImage(bmp, 0, 0)
	const at = (x, y) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)]
	return { w: bmp.width, corner: at(4, bmp.height - 4), middle: at(bmp.width - 4, Math.round(bmp.height * 0.6)) }
})
const dark = ([r, g, b]) => r + g + b < 120
if (exportPixels.w !== 390 || !dark(exportPixels.corner) || !dark(exportPixels.middle)) fail(`dark login export is not dark: ${JSON.stringify(exportPixels)}`)
step(`dark login exports 1:1 with its own dark background (${exportPixels.corner.join(',')})`)

// ------------------------------------------------------------------ turn 5: flow
await ask('add a signup screen and connect it')
await onBoth(
	() => {
		const e = window.__editor
		const s = e.getShape('shape:signup')
		if (s?.props.kind !== 'screen' || s.meta.theme?.mode !== 'dark') return false
		const arrow = e.getCurrentPageShapes().find((x) => x.type === 'arrow' && x.meta?.role === 'flow')
		if (!arrow) return false
		const ends = e.getBindingsFromShape(arrow, 'arrow').map((b) => `${b.props.terminal}:${b.toId}`)
		return ends.includes('start:shape:login_signup_link') && ends.includes('end:shape:signup')
	},
	null,
	'dark signup screen + flow arrow from "Sign up" link'
)
await bob.getByTestId('layers-panel').getByText('Sign up', { exact: true }).first().waitFor()
const log = await alice.getByTestId('agent-log').innerText()
for (const line of ['Design a login screen', 'make the button green', 'add a toggle', 'switch to dark mode', 'add a signup screen and connect it', 'connected it']) {
	if (!log.includes(line)) fail(`conversation log is missing "${line}":\n${log}`)
}
step('turn 5: "add a signup screen and connect it" → dark Sign up screen + flow arrow login_signup_link → signup; one continuous conversation in the log')

// ------------------------------------------------------------------ Bob edits in the Design panel
// Pick the title in Layers (expanded when the agent built it), falling back to a canvas selection.
const titleRow = bob.getByTestId('layers-panel').getByText('Welcome back', { exact: true })
if (await titleRow.isVisible()) await titleRow.click()
else await bob.evaluate(() => { window.__editor.select('shape:login_title') })
await bob.waitForFunction(() => window.__editor.getSelectedShapeIds().join() === 'shape:login_title')
const textBox = bob.getByTestId('design-properties').getByLabel('Text', { exact: true })
await textBox.fill('Welcome back, designer')
await textBox.blur()
await alice.waitForFunction(() => {
	const s = window.__editor.getShape('shape:login_title')
	return s?.props.text === 'Welcome back, designer' && s.meta.updatedBy?.name === 'Bob' && s.meta.author?.kind === 'agent'
}).catch(() => fail('Bob\'s Design panel edit did not reach Alice'))
step('Bob retitled the screen in the Design panel; Alice sees it, stamped updatedBy Bob')

// ------------------------------------------------------------------ Bob asks for a critique
await bob.getByRole('tab', { name: 'Agent' }).click()
await bob.getByRole('button', { name: 'Critique', exact: true }).click()
await alice.waitForFunction(
	() => {
		const e = window.__editor
		const notes = e.getCurrentPageShapes().filter((s) => s.meta?.role === 'comment' && s.meta.author?.kind === 'agent')
		const text = notes.map((n) => JSON.stringify(n.props.richText)).join(' ')
		const hl = e.getCurrentPageShapes().find((s) => s.id === 'shape:review_hl_good')
		return text.includes('@Bob') && text.includes('Welcome back, designer') && hl?.meta.targets?.includes('login_title')
	},
	null,
	{ timeout: TURN }
).catch(async () => {
	const seen = await alice.evaluate(() => window.__editor.getCurrentPageShapes().filter((s) => s.meta?.author?.kind === 'agent' && !(s.type === 'ui')).map((s) => `${s.id} ${s.meta.role} ${JSON.stringify(s.props.richText ?? '').slice(0, 200)} ${JSON.stringify(s.meta.targets ?? '')}`))
	fail(`critique did not annotate Bob's change by name:\n${seen.join('\n')}\n${await bob.getByTestId('agent-log').innerText()}`)
})
await ready(bob)
const bobLog = await bob.getByTestId('agent-log').innerText()
if (!/Bob, nice touch/.test(bobLog)) fail('spoken critique does not address Bob:\n' + bobLog)
step('Bob pressed Critique: the agent highlighted his title and left a comment "@Bob …", and said "Bob, nice touch…"')

// ------------------------------------------------------------------ guard: the agent asks before touching Bob's work
await bob.evaluate(() => { window.__editor.select('shape:login_title') })
await bob.getByRole('button', { name: 'Insert' }).click()
await bob.getByRole('menuitem', { name: 'Text', exact: true }).click()
const bobsNode = await alice.waitForFunction(() => window.__editor.getCurrentPageShapes().find((s) => s.type === 'ui' && s.meta.author?.name === 'Bob' && s.props.text === 'Body text')?.id)
const bobsId = await bobsNode.jsonValue()
step(`Bob inserted a "Body text" node (${bobsId}), authored by Bob`)
await alice.getByLabel('Message Grok Design').fill('delete the body text')
await alice.keyboard.press('Enter')
const dialog = alice.getByRole('alertdialog', { name: 'Permission request' })
await dialog.waitFor({ timeout: TURN }).catch(() => fail('the agent deleted Bob\'s node without asking'))
const prompt = await dialog.innerText()
if (!/Bob/.test(prompt)) fail('permission prompt does not name Bob: ' + prompt)
if (!(await alice.evaluate((id) => !!window.__editor.getShape(id), bobsId))) fail('Bob\'s node was deleted before Allow')
await dialog.getByRole('button', { name: 'Allow', exact: true }).click()
await onBoth((id) => !window.__editor.getShape(id), bobsId, 'Bob\'s node deleted after Allow')
await ready(alice)
step('guard: deleting Bob\'s node prompted Alice "…designed by Bob. Allow?"; after Allow it was removed on both')

// ------------------------------------------------------------------ shell sanity: code export works for the screen
await alice.evaluate(() => { window.__editor.select('shape:signup') })
await alice.getByRole('tab', { name: 'Design' }).click()
await alice.getByTestId('design-properties').getByRole('button', { name: 'Copy code' }).click()
const code = await alice.getByTestId('code-modal').innerText()
if (!/Create your account/.test(code)) fail('code export does not contain the screen content')
await alice.getByTestId('code-modal').getByRole('button', { name: 'Close' }).click()
step('Copy code exports the Sign up screen as HTML/CSS')

await alice.evaluate(() => { window.__editor.selectNone() })
await bob.evaluate(() => { window.__editor.zoomToFit() })
await bob.waitForTimeout(600)
await bob.screenshot({ path: `${out}/bob.png` })
await alice.screenshot({ path: `${out}/alice.png` })

await browser.close()
if (errors.length) {
	console.log('Browser errors:\n' + errors.join('\n'))
	process.exit(1)
}
console.log('PASS')
