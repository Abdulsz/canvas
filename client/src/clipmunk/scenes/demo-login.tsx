import { LOGIN, TurnShot, type Clock } from '../demo.tsx'

// Turn 1, as recorded: the skeleton at 0.1s, then nothing visible until create_screen at 16.5s (10.2s of it skipped, and marked).
const TALK = 600
const TALK_MS = 2300
const CLOCK: Clock = { send: 3100, cuts: [{ at: 6000, to: 16200 }] }
// create_screen lands at scene 9446.
export default function DemoLogin() {
	return (
		<TurnShot
			turn={LOGIN}
			clock={CLOCK}
			talkAt={TALK}
			talkMs={TALK_MS}
			caption="Say what you want."
			keys={['Say']}
			shots={[{ t: 3300, pad: 120 }, { t: 9500, pad: 120 }, { t: 11300, ids: ['login'], z: 0.8, ay: 0.4 }]}
		/>
	)
}
