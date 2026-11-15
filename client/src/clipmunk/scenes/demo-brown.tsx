import { BROWN, TurnShot, type Clock } from '../demo.tsx'

// Turn 2, as recorded: update_node at 1.1s. The closing question (5.3-7.7s) is skipped.
const CLOCK: Clock = { send: 2000, cuts: [{ at: 5400, to: 7700 }] }
export default function DemoBrown() {
	return (
		<TurnShot
			turn={BROWN}
			clock={CLOCK}
			talkAt={300}
			talkMs={1500}
			caption="Edit with one sentence."
			keys={['one', 'sentence.']}
			shots={[{ t: 0, ids: ['login'], z: 0.8, ay: 0.4 }, { t: 3000, ids: ['login'], z: 0.8, ay: 0.4 }, { t: 4600, ids: ['login_submit'], z: 1.15 }]}
		/>
	)
}
