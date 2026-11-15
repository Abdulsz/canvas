import { GrokDesign } from '../app.tsx'
import { agentAt, BUTTON, camera, DARK, DemoShot, handEdit, MetaRow, Pointer, USER } from '../demo.tsx'

const SELECT_AT = 1700
const EDIT_AT = 3900

export default function DemoTools() {
	return (
		<DemoShot caption="Fine-tune any layer by hand." keys={['by', 'hand.']} meta={<MetaRow note="Layers and Design panels, like Figma's" />}>
			<GrokDesign
				tab="design"
				me={USER}
				agent={() => ({ ...agentAt(DARK, 1e9), listen: null })}
				drive={({ editor, exec, t }) => {
					handEdit(editor, exec, t, EDIT_AT)
					const sel = t >= SELECT_AT ? [BUTTON] : []
					if (editor.getSelectedShapeIds().join() !== sel.join()) editor.setSelectedShapes(sel as any)
					camera(editor, t, [{ t: 0, ids: ['login'], z: 0.8, ay: 0.45 }, { t: 1800, ids: ['login'], z: 0.8, ay: 0.45 }, { t: 3200, ids: ['login_submit'], z: 1.1 }])
				}}
			/>
			<Pointer
				path={[
					{ t: 600, x: 420, y: 420 },
					{ t: 1500, x: 96, y: 220 },
					{ t: 2700, x: 96, y: 220 },
					{ t: 3500, x: 1000, y: 462 },
				]}
				clicks={[SELECT_AT - 150, EDIT_AT - 300]}
			/>
		</DemoShot>
	)
}

