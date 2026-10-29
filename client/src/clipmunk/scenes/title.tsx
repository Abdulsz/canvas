import { Surface } from 'clipmunk'
import { Orb } from '../../components/AgentPanel.tsx'
import { INK_2, Stage, Words, W, H } from '../look.tsx'

export default function Title() {
	return (
		<Stage>
			<Surface id="title" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }}>
				<div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
				{/* The app's own orb, the mark of the agent. */}
				<Orb state="idle" size={96} />
				<div style={{ marginTop: 40, fontSize: 168, fontWeight: 700, letterSpacing: '-0.05em', lineHeight: 1 }}>
					<Words text="Grok Design" start={100} stagger={120} dur={600} rise={40} />
				</div>
				<div style={{ marginTop: 40, fontSize: 46, fontWeight: 500, letterSpacing: '-0.02em', color: INK_2, textAlign: 'center' }}>
					<Words text="Describe app screens out loud." keys={['out', 'loud']} start={600} stagger={70} />
					<br />
					<Words text="Grok designs them while it talks." keys={[]} start={1050} stagger={70} />
				</div>
				</div>
			</Surface>
		</Stage>
	)
}
