import { Surface } from 'clipmunk'
import { Orb } from '../../components/AgentPanel.tsx'
import { END_NOTE, H, INK_2, Stage, W, Words } from '../look.tsx'

export default function DemoEnd() {
	return (
		<Stage>
			<Surface id="card" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }}>
				<div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
					<Orb state="idle" size={80} />
					<div style={{ marginTop: 36, fontSize: 112, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 1 }}>
						<Words text="Voice-to-UI Design Tool" start={0} stagger={90} dur={450} rise={24} />
					</div>
					<div style={{ marginTop: 44, fontSize: 44, fontWeight: 500, letterSpacing: '-0.01em' }}>
						<Words text="github.com/Abdulsz/canvas" keys={['github.com/Abdulsz/canvas']} start={300} dur={450} rise={16} />
					</div>
					{END_NOTE && (
						<div style={{ marginTop: 22, fontSize: 28, fontWeight: 500, letterSpacing: '-0.005em', color: INK_2 }}>
							<Words text={END_NOTE} start={550} stagger={40} dur={450} rise={10} />
						</div>
					)}
				</div>
			</Surface>
		</Stage>
	)
}
