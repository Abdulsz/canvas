import { Surface, useSceneTime } from 'clipmunk'
import { ACCENT, H, INK, INK_2, progress, Stage, W, Words } from '../look.tsx'

// `npm test` on the server: 49 unit tests pass (layout engine, guard, agent loop, routing, change log), plus Playwright E2E scripts.
const ITEMS = ['React', 'TypeScript', 'tldraw', 'xAI Grok tool calls', 'Auto-layout engine', '49 unit tests + E2E']

export default function DemoStack() {
	const t = useSceneTime()
	return (
		<Stage>
			<Surface id="card" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }}>
				<div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
					<div style={{ fontSize: 30, fontWeight: 600, letterSpacing: '0.14em', color: INK_2 }}>
						<Words text="UNDER THE HOOD" start={200} stagger={70} rise={12} />
					</div>
					<div style={{ marginTop: 44, display: 'grid', gridTemplateColumns: 'repeat(3, 460px)', gap: 20 }}>
						{ITEMS.map((s, i) => {
							const p = progress(t, 600 + i * 140, 500)
							const e = 1 - Math.pow(1 - p, 3)
							return (
								<div
									key={s}
									style={{
										height: 128,
										borderRadius: 20,
										background: 'rgba(255,255,255,0.05)',
										outline: '1px solid rgba(255,255,255,0.1)',
										display: 'flex',
										alignItems: 'center',
										gap: 18,
										padding: '0 32px',
										opacity: e,
										transform: `translateY(${(1 - e) * 18}px)`,
									}}
								>
									<span style={{ width: 10, height: 10, borderRadius: 5, background: ACCENT, flexShrink: 0 }} />
									<span style={{ fontSize: 38, fontWeight: 600, letterSpacing: '-0.025em', color: INK }}>{s}</span>
								</div>
							)
						})}
					</div>
				</div>
			</Surface>
		</Stage>
	)
}
