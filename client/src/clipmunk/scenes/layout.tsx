import { createShapeId, type Editor } from 'tldraw'
import { fitTo, GrokDesign, type Ctx } from '../app.tsx'
import { FeatureShot, progress } from '../look.tsx'
import { dashActivity, dashboardScreen } from '../specs.ts'

const DASH = createShapeId('dashboard')
// The mock dashboard's own numbers; the stats count up and the chart's bars rise on the scene clock.
const STATS = [
	{ id: 'dash_stat_value_1', value: 48230, fmt: (v: number) => `$${v.toLocaleString('en-US')}` },
	{ id: 'dash_stat_value_2', value: 1284, fmt: (v: number) => v.toLocaleString('en-US') },
	{ id: 'dash_stat_value_3', value: 312, fmt: (v: number) => String(v) },
	{ id: 'dash_stat_value_4', value: 37, fmt: (v: number) => String(v) },
]
const BARS = [8.2, 9.6, 8.9, 11.4, 10.6, 12.8, 12.1, 14.2, 11.8, 13.5, 15.9, 14.6]
const ease = (p: number) => 1 - Math.pow(1 - p, 3)

const applied = new WeakMap<Editor, string>()

function drive({ editor, exec, t }: Ctx) {
	if (!editor.getShape(DASH)) {
		exec.create_screen(dashboardScreen())
		exec.add_nodes({ parentId: 'dash_content', nodes: [dashActivity()] })
		const b = editor.getShapePageBounds(DASH)
		if (b) fitTo(editor, b)
		editor.selectNone()
	}
	const count = ease(progress(t, 500, 1700))
	const texts = STATS.map((s) => s.fmt(Math.round(s.value * count)))
	const data = BARS.map((v, i) => Math.round(v * ease(progress(t, 700 + i * 140, 700)) * 100) / 100)
	const key = texts.join('|') + data.join(',')
	if (applied.get(editor) === key) return
	applied.set(editor, key)
	editor.run(() => {
		STATS.forEach((s, i) => exec.update_node({ id: s.id, text: texts[i] }))
		exec.update_node({ id: 'dash_chart_plot', data })
	})
}

export default function Layout() {
	return (
		<FeatureShot caption="Real components, real auto layout" keys={['auto', 'layout']} url="grokdesign.app/r/coffee-app">
			<GrokDesign
				tab="agent"
				agent={() => ({
					speaking: true,
					log: [
						{ from: 'Ava Kim', kind: 'user', text: 'Build a dashboard for my store' },
						{ from: 'Grok', kind: 'agent', text: 'Starting a dashboard with a header, four key stats, a revenue chart and top products.' },
					],
				})}
				drive={drive}
			/>
		</FeatureShot>
	)
}
