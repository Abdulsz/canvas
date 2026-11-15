import { MENU, TurnShot, type Clock } from '../demo.tsx'

// Turn 3, as recorded: skeleton at 0.06s, create_screen at 9.7s, add_nodes (the drinks list) at 13.7s, the flow arrow at 14.1s.
const CLOCK: Clock = { send: 2800, cuts: [{ at: 5600, to: 9500 }] }
export default function DemoMenu() {
	return (
		<TurnShot
			turn={MENU}
			clock={CLOCK}
			talkAt={300}
			talkMs={2300}
			caption="Add screens and the flow between them."
			keys={['flow']}
			shots={[
				{ t: 0, ids: ['login_submit'], z: 1.15 },
				{ t: 1400, ids: ['login'], pad: 40 },
				{ t: 3000, ids: ['login'], pad: 40 },
				{ t: 4400, pad: 40 },
				{ t: 8600, pad: 40 },
				{ t: 10200, ids: ['menu'], z: 0.8, ax: 0.35, ay: 0.4 },
				{ t: 12700, ids: ['menu'], z: 0.8, ax: 0.35, ay: 0.4 },
				{ t: 14000, ids: ['login', 'menu'], z: 0.66, ay: 0.42 },
			]}
		/>
	)
}
