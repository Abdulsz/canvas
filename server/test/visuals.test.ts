import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectivePadding, expandTemplates, layoutUiTree, resolveColor, specToTree, treeToHtml } from '../../shared/design.ts'
import { artSvg, chartScaleForTest, chartSvg, compactNumber, normalizeChart, normalizeTabs } from '../../shared/visuals.ts'
import { honestSpeech, isQuickEdit, similar } from '../src/agent.ts'
import { inventsVisuals, StreamAssembler } from '../src/llm.ts'

test('template + items repeats a node per item, substituting {key} and dropping missing whole-value fields', () => {
	const spec = expandTemplates({
		id: 'nav',
		type: 'frame',
		dividers: true,
		template: { id: 'item', type: 'frame', fill: '{bg}', children: [{ id: 'label', type: 'text', text: '{label} ({n})', width: '{w}' as any }] },
		items: [{ label: 'Home', bg: '$primarySoft', n: 1, w: 120 }, { label: 'Search', n: 2 }],
	})
	assert.equal(spec.template, undefined)
	const kids = spec.children!
	assert.deepEqual(kids.map((k) => k.id), ['item_1', 'nav_div_1', 'item_2'])
	assert.equal(kids[0].fill, '$primarySoft')
	assert.equal('fill' in kids[2], false, 'missing {bg} leaves the default')
	assert.equal(kids[0].children![0].id, 'label_1')
	assert.equal(kids[0].children![0].text, 'Home (1)')
	assert.equal(kids[0].children![0].width, 120)
	const tree = specToTree(spec)
	assert.equal(tree.children.length, 3)
	assert.equal(tree.children[1].props.kind, 'divider')
})

test('badges hug their label even in a stretching column', () => {
	const tree = layoutUiTree(specToTree({ id: 'col', type: 'frame', width: 300, children: [{ id: 'b', type: 'badge', text: 'Paid' }] }))
	const badge = tree.children[0]
	assert.ok(badge.props.w < 100, `badge is ${badge.props.w} wide`)
	assert.ok(badge.props.h >= 24 && badge.props.h <= 30)
	assert.equal(badge.props.radius, 999)
})

test('chart nodes keep their data in meta and render axes, gridlines and the peak value', () => {
	const tree = specToTree({ id: 'c', type: 'chart', chart: 'bar', data: [4, 9, 6], labels: ['Mon', 'Tue', 'Wed'], prefix: '$', suffix: 'k' })
	assert.deepEqual(tree.meta.chart, { type: 'bar', data: [4, 9, 6], labels: ['Mon', 'Tue', 'Wed'], prefix: '$', suffix: 'k' })
	const svg = chartSvg(tree.meta.chart!, 400, 220, { mode: 'dark', primary: '#16a34a' }, 'c')
	assert.equal((svg.match(/<line /g) ?? []).length, 4, 'four gridlines')
	assert.match(svg, />\$9k</, 'peak value label')
	assert.match(svg, />Tue</)
	// Updating only the labels keeps the data.
	assert.deepEqual(normalizeChart({ labels: ['a', 'b', 'c'] }, tree.meta.chart)!.data, [4, 9, 6])
	assert.equal(normalizeChart({ chart: 'line' }, tree.meta.chart)!.type, 'line')
	assert.equal(compactNumber(12400), '12k')
	assert.equal(compactNumber(1500), '1.5k')
	assert.match(treeToHtml(specToTree({ id: 's', type: 'screen', children: [{ id: 'c2', type: 'chart', data: [1, 2] }] } as any, 'screen')), /<svg/)
})

test('chart scale fits the data with four round gridlines', () => {
	const { lo, step } = chartScaleForTest([8.2, 15.9, 12])
	assert.equal(lo, 0)
	assert.ok(step * 3 >= 15.9 && step * 3 <= 24, `step ${step}`)
})

test('phone screens keep content clear of the status bar, home indicator and tab bar', () => {
	const phone = specToTree({ id: 'p', padding: [24, 24, 8, 24], tabs: [{ icon: 'home', label: 'Home' }, { icon: 'user', label: 'Me' }], activeTab: 1 } as any, 'screen')
	assert.deepEqual(phone.meta.tabs, { items: [{ icon: 'home', label: 'Home' }, { icon: 'user', label: 'Me' }], active: 1 })
	assert.deepEqual(effectivePadding(phone), [52, 24, 98, 24])
	const desktop = specToTree({ id: 'd', width: 1440, height: 1024, padding: 0 } as any, 'screen')
	assert.deepEqual(effectivePadding(desktop), [0, 0, 0, 0])
	assert.equal(normalizeTabs({ tabs: [] }, phone.meta.tabs), undefined)
})

test('image art is deterministic, themed and never a flat gray box', () => {
	const a = artSvg('hero', 300, 200, { mode: 'light', primary: '#3d7a6a' }, 'calm lake at dawn')
	assert.equal(a, artSvg('hero', 300, 200, { mode: 'light', primary: '#3d7a6a' }, 'calm lake at dawn'))
	assert.notEqual(a, artSvg('hero', 300, 200, { mode: 'dark', primary: '#3d7a6a' }, 'calm lake at dawn'))
	assert.match(a, /radialGradient|linearGradient/)
})

test('dark tokens keep status pairs and brand tints readable', () => {
	for (const mode of ['light', 'dark'] as const) {
		for (const k of ['success', 'warning', 'danger']) assert.ok(resolveColor(`$${k}Soft`, { mode }) !== 'transparent')
	}
})

test('quick edits go to the fast model; new screens and rebuilds do not', () => {
	assert.equal(isQuickEdit('make the cards less cramped and use a green accent', true), true)
	assert.equal(isQuickEdit('switch everything to dark mode', true), true)
	assert.equal(isQuickEdit('add a toggle to the settings screen', true), true)
	assert.equal(isQuickEdit('add a signup screen and connect it', true), false)
	assert.equal(isQuickEdit('Build a fintech dashboard for desktop', true), false)
	assert.equal(isQuickEdit('redo the layout', true), false)
	assert.equal(isQuickEdit('make the button green', false), false)
})

test('speech helpers: repeated opener lines, invented visuals, idle sentence flush', () => {
	assert.equal(similar('Okay, a calm onboarding screen for the meditation app.', 'Okay, a calm onboarding screen for the meditation app, coming up.'), true)
	assert.equal(similar('A sage brand and a sunrise hero.', 'Okay, an onboarding screen coming up.'), false)
	assert.equal(inventsVisuals('A clean dashboard with a navy header.', 'Build a fintech dashboard'), true)
	assert.equal(inventsVisuals('Sure, switching the button to green.', 'make the button green'), false)
	const said: string[] = []
	const a = new StreamAssembler({ onSentence: (s) => said.push(s) })
	a.push({ content: 'A sage brand sets the tone.' })
	assert.deepEqual(said, [])
	a.flushIdleSentence()
	assert.deepEqual(said, ['A sage brand sets the tone.'])
	a.push({ content: ' Want a second step?' })
	a.finish()
	assert.deepEqual(said, ['A sage brand sets the tone.', 'Want a second step?'])
})

test('spoken lines never claim live or animated designs', () => {
	assert.equal(honestSpeech('A live board mock sits in the product frame.'), 'A board mock sits in the product frame.')
	assert.equal(honestSpeech('A line chart that updates every second leads the page.'), 'A line chart leads the page.')
})
