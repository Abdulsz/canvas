import { Box, type Editor, type TLShape, type TLShapeId } from 'tldraw'
import { DEVICES, treeToHtml, type Device, type UiKind, type UiNodeSpec } from '../../../shared/design.ts'
import type { CanvasExecutor } from '../agent/executor.ts'
import { fitBounds } from '../agent/layout.ts'
import { bareId, isContainer, isScreen, isUi, readUiTree, screenOf, screenTheme, uiChildren } from '../design/tree.ts'

// User actions of the app shell (Insert menu, Layers, Design panel, Export).
// Every edit goes through a CanvasExecutor created with { asUser: true }, so
// the layout logic is the agent's and the edits are stamped with the user.

const rid = () => Math.random().toString(36).slice(2, 7)

export const DEVICE_LABELS: Record<Device, string> = {
	iphone: 'iPhone',
	android: 'Android',
	tablet: 'Tablet',
	desktop: 'Desktop',
	watch: 'Watch',
}

export type ComponentKey =
	| 'button'
	| 'input'
	| 'text'
	| 'heading'
	| 'image'
	| 'card'
	| 'navbar'
	| 'listItem'
	| 'toggle'
	| 'checkbox'
	| 'avatar'
	| 'divider'
	| 'badge'
	| 'chart'

export const COMPONENTS: { key: ComponentKey; label: string; kind: UiKind; spec: (id: string) => UiNodeSpec }[] = [
	{ key: 'button', label: 'Button', kind: 'button', spec: (id) => ({ id, type: 'button', name: 'Button', text: 'Button' }) },
	{ key: 'input', label: 'Input', kind: 'input', spec: (id) => ({ id, type: 'input', name: 'Input', text: 'Placeholder' }) },
	{ key: 'heading', label: 'Heading', kind: 'text', spec: (id) => ({ id, type: 'text', name: 'Heading', text: 'Heading', fontSize: 28, fontWeight: 700 }) },
	{ key: 'text', label: 'Text', kind: 'text', spec: (id) => ({ id, type: 'text', name: 'Text', text: 'Body text', textColor: '$muted' }) },
	{ key: 'image', label: 'Image', kind: 'image', spec: (id) => ({ id, type: 'image', name: 'Image' }) },
	{
		key: 'card',
		label: 'Card',
		kind: 'frame',
		spec: (id) => ({
			id,
			type: 'frame',
			name: 'Card',
			fill: '$surface',
			stroke: '$border',
			radius: 16,
			shadow: 'sm',
			padding: 16,
			gap: 8,
			children: [
				{ id: `${id}_image`, type: 'image', name: 'Cover', height: 140, radius: 10 },
				{ id: `${id}_title`, type: 'text', name: 'Title', text: 'Card title', fontSize: 17, fontWeight: 600 },
				{ id: `${id}_body`, type: 'text', name: 'Body', text: 'A short line of supporting text.', fontSize: 14, textColor: '$muted' },
			],
		}),
	},
	{
		key: 'navbar',
		label: 'Navbar',
		kind: 'frame',
		spec: (id) => ({
			id,
			type: 'frame',
			name: 'Navbar',
			layout: 'horizontal',
			justify: 'space-between',
			alignItems: 'center',
			padding: [8, 0],
			children: [
				{ id: `${id}_menu`, type: 'icon', name: 'Menu', icon: 'menu' },
				{ id: `${id}_title`, type: 'text', name: 'Title', text: 'Title', fontSize: 17, fontWeight: 600 },
				{ id: `${id}_avatar`, type: 'avatar', name: 'Avatar', text: 'Jane Doe', width: 32, height: 32 },
			],
		}),
	},
	{
		key: 'listItem',
		label: 'List item',
		kind: 'frame',
		spec: (id) => ({
			id,
			type: 'frame',
			name: 'List item',
			layout: 'horizontal',
			alignItems: 'center',
			gap: 12,
			padding: [10, 0],
			children: [
				{ id: `${id}_avatar`, type: 'avatar', name: 'Avatar', text: 'Alex Kim' },
				{
					id: `${id}_labels`,
					type: 'frame',
					name: 'Labels',
					width: 'fill',
					gap: 2,
					children: [
						{ id: `${id}_title`, type: 'text', name: 'Title', text: 'List item', fontWeight: 500 },
						{ id: `${id}_subtitle`, type: 'text', name: 'Subtitle', text: 'Supporting line', fontSize: 14, textColor: '$muted' },
					],
				},
				{ id: `${id}_chevron`, type: 'icon', name: 'Chevron', icon: 'chevron-right', textColor: '$muted', width: 20, height: 20 },
			],
		}),
	},
	{ key: 'toggle', label: 'Toggle', kind: 'toggle', spec: (id) => ({ id, type: 'toggle', name: 'Toggle', checked: true }) },
	{ key: 'checkbox', label: 'Checkbox', kind: 'checkbox', spec: (id) => ({ id, type: 'checkbox', name: 'Checkbox', text: 'Remember me', checked: true }) },
	{ key: 'avatar', label: 'Avatar', kind: 'avatar', spec: (id) => ({ id, type: 'avatar', name: 'Avatar', text: 'Jane Doe' }) },
	{ key: 'divider', label: 'Divider', kind: 'divider', spec: (id) => ({ id, type: 'divider', name: 'Divider' }) },
	{ key: 'badge', label: 'Badge', kind: 'badge', spec: (id) => ({ id, type: 'badge', name: 'Badge', text: 'New' }) },
	{
		key: 'chart',
		label: 'Chart',
		kind: 'chart',
		spec: (id) => ({ id, type: 'chart', name: 'Chart', chart: 'bar', data: [12, 18, 15, 24, 21, 30, 27], labels: ['M', 'T', 'W', 'T', 'F', 'S', 'S'] }) as UiNodeSpec,
	},
]

/** Brings a shape into view: zooms to a screen, pans to a node. Does nothing if it is already visible. */
export function revealShape(editor: Editor, id: TLShapeId, force = false) {
	const bounds = editor.getShapePageBounds(id)
	if (!bounds) return
	const vp = editor.getViewportPageBounds()
	if (!force && Box.Contains(vp, bounds)) return
	const shape = editor.getShape(id)
	if (isScreen(shape) || bounds.w > vp.w * 0.9 || bounds.h > vp.h * 0.9) {
		fitBounds(editor, bounds, { inset: 56, maxZoom: Math.min(1, Math.max(editor.getZoomLevel() * 1.5, 0.25)) })
	} else editor.centerOnPoint(bounds.center, { animation: { duration: 320 } })
}

export function selectAndReveal(editor: Editor, id: TLShapeId) {
	editor.select(id)
	revealShape(editor, id)
}

export function screens(editor: Editor) {
	return editor
		.getCurrentPageShapes()
		.filter(isScreen)
		.sort((a, b) => a.x - b.x || a.y - b.y)
}

export async function insertScreen(editor: Editor, exec: CanvasExecutor, device: Device) {
	const n = screens(editor).length + 1
	const id = `screen_${rid()}`
	const r = await exec.run('create_screen', { id, name: `${DEVICE_LABELS[device]} ${n}`, device })
	if (!r.ok) return r
	const shapeId = `shape:${id}` as TLShapeId
	editor.select(shapeId)
	revealShape(editor, shapeId, true)
	return r
}

/** Where an inserted component goes: into the selected container, after the selected node, or a new screen. */
function insertTarget(editor: Editor): { parent: TLShape; index?: number } | null {
	const sel = editor.getSelectedShapes()[0]
	if (!sel) return null
	if (isContainer(sel)) return { parent: sel }
	const parent = editor.getShape(sel.parentId as TLShapeId)
	if ((sel as TLShape).type === 'ui' && isContainer(parent)) {
		const index = uiChildren(editor, parent).findIndex((c) => c.id === (sel as TLShape).id)
		return { parent, index: index >= 0 ? index + 1 : undefined }
	}
	return null
}

export async function insertComponent(editor: Editor, exec: CanvasExecutor, key: ComponentKey) {
	const def = COMPONENTS.find((c) => c.key === key)!
	const id = `${key.toLowerCase()}_${rid()}`
	const target = insertTarget(editor)
	if (!target) {
		// No screen/frame selected: a new phone screen holding the component.
		const sid = `screen_${rid()}`
		const r = await exec.run('create_screen', { id: sid, name: `iPhone ${screens(editor).length + 1}`, device: 'iphone', children: [def.spec(id)] })
		if (!r.ok) return r
		editor.select(`shape:${id}` as TLShapeId)
		revealShape(editor, `shape:${sid}` as TLShapeId, true)
		return r
	}
	const r = await exec.run('add_nodes', { parentId: target.parent.id, index: target.index, nodes: [def.spec(id)] })
	if (r.ok) {
		const added = (r.data as { added?: { id: string }[] })?.added?.[0]?.id ?? id
		const shapeId = `shape:${added}` as TLShapeId
		editor.select(shapeId)
		revealShape(editor, shapeId)
	}
	return r
}

/** Standalone HTML/CSS for a node's subtree, themed by its screen. */
export function htmlFor(editor: Editor, id: TLShapeId): { name: string; html: string } | null {
	const shape = editor.getShape(id)
	if (!isUi(shape)) return null
	return { name: shape.props.name || bareId(shape.id), html: treeToHtml(readUiTree(editor, shape), screenTheme(screenOf(editor, shape))) }
}

/** The screen the user is working on: the selection's screen, else the first screen. */
export function activeScreen(editor: Editor) {
	const sel = editor.getSelectedShapes()[0]
	return screenOf(editor, sel) ?? screens(editor)[0] ?? null
}

export async function exportPng(editor: Editor, id: TLShapeId) {
	const shape = editor.getShape(id)
	if (!shape) return
	const { blob } = await editor.toImage([id], { format: 'png', background: true, padding: 0, scale: 2 })
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = `${(isUi(shape) && shape.props.name) || bareId(id)}.png`.replace(/[^\w.-]+/g, '-')
	document.body.appendChild(a)
	a.click()
	a.remove()
	setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export { DEVICES }
