import { CRITIQUE, Pointer, TurnShot, type Clock } from '../demo.tsx'

// The recorded Critique turn: get_canvas_state with the audit at 0.1s, the first highlight at 10.0s
// (7.7s of thinking skipped, and marked), four notes by 12.5s, Grok's voice from 10.4s.
const CLOCK: Clock = { send: 1100, cuts: [{ at: 2200, to: 9900 }] }
export default function DemoCritique() {
	return (
		<TurnShot
			turn={CRITIQUE}
			clock={CLOCK}
			talkAt={0}
			talkMs={0}
			caption="Ask for an honest critique."
			keys={['honest']}
			edited
			shots={[
				{ t: 0, pad: 150 },
				{ t: 5900, pad: 150 },
				{ t: 7100, ids: ['login', 'c_login_praise'], pad: 24 },
				{ t: 7900, ids: ['login', 'c_login_praise'], pad: 24 },
				{ t: 9100, ids: ['menu', 'c_menu_add', 'c_menu_food'], pad: 24 },
			]}
		>
			<Pointer path={[{ t: 200, x: 700, y: 420 }, { t: 900, x: 1120, y: 248 }]} clicks={[950]} />
		</TurnShot>
	)
}
