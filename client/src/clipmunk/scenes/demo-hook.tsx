import { GrokDesign } from '../app.tsx'
import { agentAt, camera, DARK, DemoShot, replay, USER } from '../demo.tsx'

// The end of the recorded conversation (four requests): the dark login and menu flow.
export default function DemoHook() {
	return (
		<DemoShot caption="Design app screens by talking." keys={['talking.']} captionStart={250}>
			<GrokDesign
				tab="agent"
				me={USER}
				agent={() => ({ ...agentAt(DARK, 1e9), listen: null })}
				drive={({ editor, exec, t }) => {
					replay(editor, exec, DARK, 1e9)
					camera(editor, t, [{ t: 0, pad: 28 }])
				}}
			/>
		</DemoShot>
	)
}
