import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	applySpec,
	kindDefaults,
	layoutTree,
	layoutUiTree,
	estimateText,
	wrapWith,
	normalizePadding,
	resolveColor,
	contrast,
	specToTree,
	THEMES,
	treeToHtml,
	type LayoutNode,
} from '../../shared/design.ts'

const box = (id: string, w: number, h: number, extra: Partial<LayoutNode> = {}): LayoutNode => ({ id, kind: 'rect', w, h, ...extra })
const frame = (id: string, w: number, h: number, layout: LayoutNode['layout'], children: LayoutNode[], extra: Partial<LayoutNode> = {}): LayoutNode => ({
	id,
	kind: 'frame',
	w,
	h,
	layout,
	children,
	...extra,
})

test('vertical layout stacks children with gap and padding', () => {
	const out = layoutTree(frame('root', 200, 300, { mode: 'vertical', gap: 10, padding: [20, 16, 20, 16] }, [box('a', 50, 40), box('b', 60, 30)]))
	assert.deepEqual(out.get('a'), { x: 16, y: 20, w: 50, h: 40 })
	assert.deepEqual(out.get('b'), { x: 16, y: 70, w: 60, h: 30 })
})

test('horizontal layout with center cross alignment', () => {
	const out = layoutTree(frame('root', 300, 100, { mode: 'horizontal', gap: 8, padding: [0, 0, 0, 0], alignItems: 'center' }, [box('a', 40, 40), box('b', 20, 20)]))
	assert.deepEqual(out.get('a'), { x: 0, y: 30, w: 40, h: 40 })
	assert.deepEqual(out.get('b'), { x: 48, y: 40, w: 20, h: 20 })
})

test('hug container sizes to children + gaps + padding', () => {
	const out = layoutTree(
		frame('root', 999, 999, { mode: 'horizontal', gap: 10, padding: [5, 5, 5, 5] }, [box('a', 40, 40), box('b', 30, 20)], { sizing: { w: 'hug', h: 'hug' } })
	)
	assert.deepEqual(out.get('root'), { x: 0, y: 0, w: 90, h: 50 })
})

test('fill children split the remaining primary-axis space equally', () => {
	const out = layoutTree(
		frame('root', 300, 50, { mode: 'horizontal', gap: 10, padding: [0, 0, 0, 0] }, [
			box('fixed', 80, 50),
			box('f1', 0, 50, { sizing: { w: 'fill', h: 'fixed' } }),
			box('f2', 0, 50, { sizing: { w: 'fill', h: 'fixed' } }),
		])
	)
	assert.equal(out.get('f1')!.w, 100)
	assert.equal(out.get('f2')!.w, 100)
	assert.equal(out.get('f2')!.x, 200)
})

test('fill on the cross axis and stretch take the inner width', () => {
	const out = layoutTree(
		frame('root', 300, 300, { mode: 'vertical', gap: 0, padding: [0, 20, 0, 20], alignItems: 'stretch' }, [
			box('hug', 10, 10, { sizing: { w: 'hug', h: 'fixed' } }),
			box('fill', 10, 10, { sizing: { w: 'fill', h: 'fixed' } }),
			box('fixed', 10, 10),
		])
	)
	assert.equal(out.get('hug')!.w, 260)
	assert.equal(out.get('fill')!.w, 260)
	assert.equal(out.get('fixed')!.w, 10)
})

test('justify space-between spreads children', () => {
	const out = layoutTree(frame('root', 200, 40, { mode: 'horizontal', gap: 0, padding: [0, 0, 0, 0], justify: 'space-between' }, [box('a', 20, 20), box('b', 20, 20), box('c', 20, 20)]))
	assert.equal(out.get('a')!.x, 0)
	assert.equal(out.get('b')!.x, 90)
	assert.equal(out.get('c')!.x, 180)
})

test('justify center and end on the primary axis', () => {
	const c = layoutTree(frame('root', 100, 200, { mode: 'vertical', gap: 0, padding: [0, 0, 0, 0], justify: 'center' }, [box('a', 10, 50)]))
	assert.equal(c.get('a')!.y, 75)
	const e = layoutTree(frame('root', 100, 200, { mode: 'vertical', gap: 0, padding: [0, 0, 0, 0], justify: 'end' }, [box('a', 10, 50)]))
	assert.equal(e.get('a')!.y, 150)
})

test('nested hug frame inside a fixed parent', () => {
	const inner = frame('inner', 0, 0, { mode: 'horizontal', gap: 4, padding: [8, 8, 8, 8] }, [box('x', 10, 10), box('y', 10, 30)], { sizing: { w: 'hug', h: 'hug' } })
	const out = layoutTree(frame('root', 200, 200, { mode: 'vertical', gap: 0, padding: [10, 10, 10, 10] }, [inner, box('after', 5, 5)]))
	assert.deepEqual(out.get('inner'), { x: 10, y: 10, w: 40, h: 46 })
	assert.deepEqual(out.get('y'), { x: 22, y: 8, w: 10, h: 30 })
	assert.equal(out.get('after')!.y, 56)
})

test('mode none keeps child positions', () => {
	const out = layoutTree(frame('root', 200, 200, { mode: 'none' }, [box('a', 10, 10, { x: 33, y: 44 })]))
	assert.deepEqual(out.get('a'), { x: 33, y: 44, w: 10, h: 10 })
})

test('text hugs its measured size and wraps when stretched', () => {
	const m = estimateText('Hello', 20)
	assert.equal(m.w, Math.ceil(5 * 0.55 * 20))
	assert.equal(m.h, 28)
	const long = 'word '.repeat(40).trim()
	const out = layoutTree(
		frame('root', 200, 400, { mode: 'vertical', gap: 0, padding: [0, 0, 0, 0], alignItems: 'stretch' }, [
			{ id: 't', kind: 'text', w: 0, h: 0, text: long, fontSize: 16, sizing: { w: 'hug', h: 'hug' } },
		])
	)
	assert.equal(out.get('t')!.w, 200)
	assert.ok(out.get('t')!.h > 16 * 1.4 * 3, 'wraps onto several lines')
})

test('specToTree applies kind defaults and normalizes padding', () => {
	const tree = specToTree(
		{
			id: 'login',
			padding: [32, 24],
			children: [
				{ id: 'title', type: 'text', text: 'Welcome back', fontSize: 28, fontWeight: 700 },
				{ id: 'cta', type: 'button', text: 'Sign in' },
				{ id: 'row', type: 'frame', layout: 'horizontal', children: [{ id: 'email', type: 'input', text: 'Email', icon: 'mail' }] },
				{ id: 'pic', type: 'image', width: 120, height: 'hug' },
			],
		},
		'screen'
	)
	assert.equal(tree.props.kind, 'screen')
	assert.equal(tree.props.w, 390)
	assert.deepEqual(tree.meta.layout!.padding, [32, 24, 32, 24])
	const [title, cta, row, pic] = tree.children
	assert.equal(title.props.fontSize, 28)
	assert.equal(title.props.textColor, '$text')
	assert.equal(cta.props.fill, '$primary')
	assert.equal(cta.props.h, 48)
	assert.deepEqual(cta.meta.sizing, { w: 'hug', h: 'fixed' })
	assert.equal(row.meta.layout!.mode, 'horizontal')
	assert.equal(row.meta.layout!.alignItems, 'center')
	assert.equal(row.children[0].props.icon, 'mail')
	assert.deepEqual(pic.meta.sizing, { w: 'fixed', h: 'hug' })
	assert.equal(pic.props.w, 120)
	assert.deepEqual(tree.children.map((c) => c.meta.order), [0, 1, 2, 3])
	assert.deepEqual(normalizePadding(8), [8, 8, 8, 8])
	assert.deepEqual(normalizePadding([1, 2, 3]), [1, 2, 3, 2])
})

test('layoutUiTree lays out a login screen', () => {
	const tree = layoutUiTree(
		specToTree(
			{
				id: 's',
				justify: 'center',
				children: [
					{ id: 'title', type: 'text', text: 'Log in', align: 'center' },
					{ id: 'email', type: 'input', text: 'Email' },
					{ id: 'go', type: 'button', text: 'Continue' },
				],
			},
			'screen'
		)
	)
	const [title, email, go] = tree.children
	assert.equal(email.props.w, 390 - 48)
	assert.equal(go.props.w, 390 - 48)
	assert.equal(go.props.h, 48)
	assert.ok(title.y > 300 && title.y < 400, `content is centered vertically (title.y=${title.y})`)
})

test('applySpec updates sizing and layout without children', () => {
	const base = kindDefaults('frame')
	const { props, meta } = applySpec(base.props, base.meta, { width: 'hug', gap: 20, fill: '#ff0000', layout: 'horizontal' })
	assert.equal(props.fill, '#ff0000')
	assert.equal(meta.sizing.w, 'hug')
	assert.equal(meta.layout!.gap, 20)
	assert.equal(meta.layout!.mode, 'horizontal')
})

test('resolveColor handles tokens, themes and literals', () => {
	assert.equal(resolveColor('$bg', { mode: 'dark' }), THEMES.dark.bg)
	assert.equal(resolveColor('$primary', { mode: 'light', primary: '#2563eb' }), '#2563eb')
	// A mid-tone brand is deepened just enough for white labels to reach 4.5:1 (light and dark).
	for (const mode of ['light', 'dark'] as const) {
		for (const primary of ['#ff0000', '#16a34a', '#3d7a68', '#5c3a21']) {
			const p = resolveColor('$primary', { mode, primary })
			assert.ok(contrast(p, resolveColor('$onPrimary', { mode, primary })) >= 4.5, `${mode} ${primary} -> ${p}`)
		}
	}
	assert.equal(resolveColor('#123456'), '#123456')
	assert.equal(resolveColor('transparent'), 'transparent')
	// A dark brand color is lightened in dark mode so it reads on the dark background.
	const darkBrown = resolveColor('$primary', { mode: 'dark', primary: '#5c3a21' })
	assert.notEqual(darkBrown, '#5c3a21')
	assert.ok(contrast(darkBrown, THEMES.dark.bg) >= 3)
	assert.ok(contrast(resolveColor('$primary', { mode: 'dark', primary: '#16a34a' }), THEMES.dark.bg) >= 3)
	// Text on a light brand color is dark.
	assert.equal(resolveColor('$onPrimary', { mode: 'light', primary: '#facc15' }), '#111827')
	assert.equal(resolveColor('$onPrimary', { mode: 'light', primary: '#5c3a21' }), '#ffffff')
})

test('treeToHtml emits a standalone flexbox document', () => {
	const tree = layoutUiTree(
		specToTree({ id: 'home', name: 'Home', children: [{ id: 't', type: 'text', text: 'Hi <there>' }, { id: 'b', type: 'button', text: 'Go', icon: 'arrow-right' }] }, 'screen')
	)
	const html = treeToHtml(tree)
	assert.match(html, /^<!doctype html>/)
	assert.match(html, /display: flex; flex-direction: column/)
	assert.match(html, /Hi &lt;there&gt;/)
	assert.match(html, /<button[^>]*>.*<svg/)
	assert.match(html, /--primary: #5b5bd6/)
})

test('layoutTree accepts a custom text measurer', () => {
	const measure = (text: string, fs: number, maxWidth?: number) => wrapWith((s) => s.length * 10, text, fs, maxWidth)
	const out = layoutTree({ id: 't', kind: 'text', w: 0, h: 0, text: 'abcd', fontSize: 10, sizing: { w: 'hug', h: 'hug' } }, { measure })
	assert.deepEqual(out.get('t'), { x: 0, y: 0, w: 40, h: 14 })
	const wrapped = wrapWith((s) => s.length * 10, 'aa bb cc', 10, 50)
	assert.deepEqual(wrapped, { w: 50, h: 28 })
})

test('status badges have semantic tones, independent of the brand', async () => {
	const { statusTone } = await import('../../shared/design.ts')
	assert.equal(statusTone('Received'), 'success')
	assert.equal(statusTone('Pending'), 'warning')
	assert.equal(statusTone('Failed'), 'danger')
	assert.equal(statusTone('Sent'), 'info')
	assert.equal(statusTone('Groceries'), null)
	// Two statuses never share a color, light or dark, whatever the brand.
	for (const mode of ['light', 'dark'] as const) assert.notEqual(resolveColor('$success', { mode, primary: '#15803d' }), resolveColor('$info', { mode, primary: '#15803d' }))
})

test('abbreviated ids become readable layer names', async () => {
	const { humanLayerName } = await import('../../shared/design.ts')
	assert.equal(humanLayerName({ id: 'ob_art', kind: 'image', h: 360 }, { id: 'onboarding', name: 'Onboarding' }), 'Hero art')
	assert.equal(humanLayerName({ id: 'set_acct', kind: 'frame', heading: 'ACCOUNT' }, { id: 'settings', name: 'Settings' }), 'Account section')
	assert.equal(humanLayerName({ id: 'set_noti', kind: 'frame' }, { id: 'settings', name: 'Settings' }), 'Notifications section')
	assert.equal(humanLayerName({ id: 'tx_row_3', kind: 'frame' }, null), 'Transactions row 3')
})

test('phones and desktop app screens have a fold; landing pages scroll', async () => {
	const { foldHeight } = await import('../../shared/design.ts')
	assert.equal(foldHeight({ w: 390 }), 844)
	assert.equal(foldHeight({ w: 1440, layoutMode: 'horizontal' }), 1024)
	assert.equal(foldHeight({ w: 1440, layoutMode: 'vertical', name: 'Landing page' }), null)
})
