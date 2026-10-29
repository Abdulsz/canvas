import { createShapeId } from 'tldraw'
import { fitTo, GrokDesign } from '../app.tsx'
import { FeatureShot } from '../look.tsx'
import { coffeeLogin } from '../specs.ts'

// Typed into the real agent field on the scene clock; the recipe's typing sound uses the same numbers.
const PROMPT = 'Design a login screen for a coffee app'
const TYPE_AT = 1300
const PER_SECOND = 20
const SENT_AT = TYPE_AT + (PROMPT.length / PER_SECOND) * 1000 + 120
const BUILT_AT = SENT_AT + 260
const LOGIN = createShapeId('login')

export default function Speak() {
	return (
		<FeatureShot caption="Speak a screen into existence" keys={['Speak']} url="grokdesign.app/r/coffee-app">
			<GrokDesign
				tab="agent"
				typing={(t) => (t < TYPE_AT || t >= SENT_AT ? '' : PROMPT.slice(0, Math.floor(((t - TYPE_AT) / 1000) * PER_SECOND)))}
				agent={(t) =>
					t < SENT_AT
						? {}
						: t < BUILT_AT
							? { busy: true, activity: 'Designing…', log: [{ from: 'Ava Kim', kind: 'user', text: PROMPT }] }
							: {
									speaking: true,
									log: [
										{ from: 'Ava Kim', kind: 'user', text: PROMPT },
										{ from: 'Grok', kind: 'agent', text: 'Here is a warm, simple login for your coffee app, with social sign-in under the button.' },
									],
								}
				}
				drive={({ editor, exec, t }) => {
					const built = !!editor.getShape(LOGIN)
					if (t >= BUILT_AT && !built) {
						exec.create_screen(coffeeLogin())
						const b = editor.getShapePageBounds(LOGIN)
						if (b) fitTo(editor, b)
						editor.selectNone()
					} else if (t < BUILT_AT && built) {
						editor.deleteShapes([LOGIN])
					}
				}}
			/>
		</FeatureShot>
	)
}
