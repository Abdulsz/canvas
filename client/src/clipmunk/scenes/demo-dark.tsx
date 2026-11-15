import { DARK, TurnShot, type Clock } from '../demo.tsx'

// Turn 4, as recorded: set_theme dark on every screen at 1.2s; shown in full (turn done at 6.85s).
const CLOCK: Clock = { send: 2000, cuts: [] }
export default function DemoDark() {
	return (
		<TurnShot
			turn={DARK}
			clock={CLOCK}
			talkAt={300}
			talkMs={1500}
			caption="Restyle everything at once."
			keys={['everything']}
			shots={[{ t: 0, ids: ['login', 'menu'], z: 0.66, ay: 0.42 }, { t: 2200, ids: ['login', 'menu'], z: 0.66, ay: 0.42 }, { t: 3600, pad: 28 }]}
		/>
	)
}
