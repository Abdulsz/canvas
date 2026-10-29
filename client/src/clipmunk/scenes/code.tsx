import { createShapeId } from 'tldraw'
import { fitTo, GrokDesign, type Ctx } from '../app.tsx'
import { FeatureShot } from '../look.tsx'
import { coffeeLogin } from '../specs.ts'

const LOGIN = createShapeId('login')
const OPEN_AT = 1000

function drive({ editor, exec }: Ctx) {
	if (!editor.getShape(LOGIN)) {
		exec.create_screen(coffeeLogin())
		const b = editor.getShapePageBounds(LOGIN)
		if (b) fitTo(editor, b)
		editor.select(LOGIN)
	}
}

export default function Code() {
	return (
		<FeatureShot caption="Ship it as code" keys={['code']} url="grokdesign.app/r/coffee-app">
			<GrokDesign tab="design" drive={drive} code={(t) => (t >= OPEN_AT ? LOGIN : null)} />
		</FeatureShot>
	)
}
