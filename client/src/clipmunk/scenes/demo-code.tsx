import { GrokDesign } from '../app.tsx'
import { agentAt, camera, DARK, DemoShot, handEdit, MetaRow, USER } from '../demo.tsx'

const OPEN_AT = 900

export default function DemoCode() {
	return (
		<DemoShot caption="Export real HTML and CSS." keys={['HTML', 'CSS.']} meta={<MetaRow note="Copy code: standalone HTML/CSS with a live preview" />}>
			<GrokDesign
				tab="design"
				me={USER}
				agent={() => ({ ...agentAt(DARK, 1e9), listen: null })}
				drive={({ editor, exec, t }) => {
					handEdit(editor, exec, t, -1)
					if (editor.getSelectedShapeIds().join() !== 'shape:login') editor.setSelectedShapes(['shape:login' as any])
					camera(editor, t, [{ t: 0, ids: ['login'], pad: 60 }])
				}}
				code={(t) => (t >= OPEN_AT ? 'shape:login' : null)}
			/>
		</DemoShot>
	)
}
