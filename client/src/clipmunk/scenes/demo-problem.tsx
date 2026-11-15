import { GrokDesign } from '../app.tsx'
import { DemoShot, USER } from '../demo.tsx'

// The real empty file, before anything is said.
export default function DemoProblem() {
	return (
		<DemoShot caption="Mockups take hours of clicking." keys={['hours']} captionStart={200}>
			<GrokDesign tab="agent" me={USER} agent={() => ({ listen: null })} />
		</DemoShot>
	)
}
