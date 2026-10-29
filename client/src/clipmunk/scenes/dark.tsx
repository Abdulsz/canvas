import { createShapeId } from 'tldraw'
import { fitTo, GrokDesign, type Ctx } from '../app.tsx'
import { FeatureShot } from '../look.tsx'
import { coffeeLogin, coffeeSignup } from '../specs.ts'
import { screenTheme } from '../../design/tree.ts'
import type { UiShape } from '../../design/UiShapeUtil.tsx'

const LOGIN = createShapeId('login')
const HEARD_AT = 900
const SAID_AT = 1900
const DARK_AT = 2300
const REQUEST = 'Switch to dark mode'

function drive({ editor, exec, t }: Ctx) {
	if (!editor.getShape(LOGIN)) {
		exec.create_screen(coffeeLogin())
		exec.create_screen(coffeeSignup())
		exec.connect_screens({ fromId: 'login_signup_link', toId: 'signup' })
		const b = editor.getCurrentPageBounds()
		if (b) fitTo(editor, b)
		editor.selectNone()
	}
	const mode = t >= DARK_AT ? 'dark' : 'light'
	if (screenTheme(editor.getShape(LOGIN) as UiShape).mode !== mode) exec.set_theme({ screenId: 'all', mode })
}

export default function Dark() {
	return (
		<FeatureShot caption="Dark mode in one sentence" keys={['Dark', 'mode']} url="grokdesign.app/r/coffee-app">
			<GrokDesign
				tab="agent"
				agent={(t) =>
					t < HEARD_AT
						? {}
						: t < SAID_AT
							? { listen: 'hearing' }
							: t < DARK_AT
								? { listen: 'listening', busy: true, activity: 'Switching to dark mode…', log: [{ from: 'Ava Kim', kind: 'user', text: REQUEST }] }
								: {
										listen: 'listening',
										speaking: true,
										log: [
											{ from: 'Ava Kim', kind: 'user', text: REQUEST },
											{ from: 'Grok', kind: 'agent', text: 'Done. Both screens are dark now, and the coffee brown still reads on every button.' },
										],
									}
				}
				drive={drive}
			/>
		</FeatureShot>
	)
}
