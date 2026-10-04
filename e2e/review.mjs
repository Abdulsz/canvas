// Live review test against real Grok: a student draws a small design with freehand
// arrows and an unconnected cache, presses Check my work, and the agent annotates it.
// Requires the server to run with XAI_API_KEY. Usage: node e2e/review.mjs [outDir]
import { chromium } from 'playwright'
const BASE = process.env.BASE_URL ?? 'http://localhost:8787'
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => localStorage.setItem('grok-whiteboard:identity', JSON.stringify({ userId: 'bob', name: 'Bob', color: '#0a84ff' })))
const page = await ctx.newPage()
const t0 = Date.now(); const mark = (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${m}`)
await page.goto(`${BASE}/r/review` + Date.now().toString(36))
await page.getByTestId('agent-activity').getByText('Ready').waitFor()
const rt = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
await page.evaluate(() => {
	const rt = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
	const e = window.__editor
	e.createShapes([
		{ id: 'shape:c', type: 'geo', x: 0, y: 0, props: { w: 160, h: 80, richText: rt('Client') } },
		{ id: 'shape:api', type: 'geo', x: 300, y: 0, props: { w: 160, h: 80, richText: rt('API Server') } },
		{ id: 'shape:db', type: 'geo', x: 600, y: 0, props: { w: 160, h: 80, geo: 'ellipse', richText: rt('Database') } },
		{ id: 'shape:cache', type: 'geo', x: 300, y: 220, props: { w: 160, h: 80, richText: rt('Cache') } },
	])
	e.zoomToFit(); e.setCurrentTool('draw')
})
// Freehand arrows: client->api, api->db (no arrow to the cache)
const box = async (id) => page.evaluate((id) => { const b = window.__editor.getShapePageBounds(id); const a = window.__editor.pageToViewport({ x: b.maxX, y: b.center.y }); return a }, id)
for (const [from, toX] of [['shape:c', 290], ['shape:api', 590]]) {
	const p = await box(from)
	const end = await page.evaluate((x) => window.__editor.pageToViewport({ x, y: 40 }).x, toX)
	await page.mouse.move(p.x + 5, p.y); await page.mouse.down()
	for (let x = p.x + 5; x <= end; x += 8) await page.mouse.move(x, p.y + Math.sin(x / 15) * 3)
	await page.mouse.move(end - 12, p.y - 10); await page.mouse.move(end, p.y); await page.mouse.move(end - 12, p.y + 10)
	await page.mouse.up()
}
await page.evaluate(() => { window.__editor.setCurrentTool('select') })
mark('Bob drew: Client → API Server → Database (freehand arrows), plus an unconnected Cache')
await page.getByRole('button', { name: /Check my work/ }).click()
await page.getByTestId('agent-activity').getByText('Ready').waitFor({ state: 'hidden' })
await page.getByTestId('agent-activity').getByText('Ready').waitFor({ timeout: 180000 })
mark('review finished')
const annotations = await page.evaluate(() => window.__editor.getCurrentPageShapes().filter((s) => s.meta?.author?.kind === 'agent').map((s) => `${s.type}${s.meta?.role ? '/' + s.meta.role : ''}${s.meta?.suggestion ? '/suggestion' : ''}`))
const bobShapes = await page.evaluate(() => window.__editor.getCurrentPageShapes().filter((s) => s.meta?.author?.name === 'Bob').length)
console.log('agent shapes:', annotations.join(', '), '| Bob shapes intact:', bobShapes)
if (bobShapes !== 6) throw new Error("Bob's shapes were changed")
if (!annotations.some((a) => a.includes('annotation') || a.includes('comment'))) throw new Error('no on-board feedback')
await page.evaluate(() => { window.__editor.zoomToFit() }); await page.waitForTimeout(600)
await page.screenshot({ path: `${process.argv[2] ?? '.'}/review-live.png` })
console.log('\n' + (await page.getByTestId('agent-log').innerText()))
await browser.close()
