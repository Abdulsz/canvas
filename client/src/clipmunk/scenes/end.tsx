import { Surface } from 'clipmunk'
import { Orb } from '../../components/AgentPanel.tsx'
import { INK_2, Stage, Words, W, H } from '../look.tsx'

export default function End() {
	return (
		<Stage>
			<Surface id="card" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }}>
				<div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
				<Orb state="idle" size={80} />
				<div style={{ marginTop: 36, fontSize: 132, fontWeight: 700, letterSpacing: '-0.05em', lineHeight: 1 }}>
					<Words text="Grok Design" start={0} stagger={90} dur={450} rise={24} />
				</div>
				<div style={{ marginTop: 44, fontSize: 44, fontWeight: 500, letterSpacing: '-0.01em', color: INK_2 }}>
					<Words text="github.com/Abdulsz/canvas" keys={['github.com/Abdulsz/canvas']} start={250} dur={450} rise={16} />
				</div>
				</div>
			</Surface>
		</Stage>
	)
}
