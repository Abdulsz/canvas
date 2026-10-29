import type { Editor, TLShape, TLShapeId } from 'tldraw'
import { DEFAULT_THEME, isContainerKind, KIND_DEFAULTS, type ThemeSpec, type UiMeta, type UiTreeNode } from '../../../shared/design.ts'
import type { UiShape } from './UiShapeUtil.tsx'

// Read helpers over the editor's 'ui' shapes, shared by the executor and the app shell.

export const bareId = (id: string) => id.replace(/^shape:/, '')
export const isUi = (s: TLShape | undefined | null): s is UiShape => s?.type === 'ui'
export const isScreen = (s: TLShape | undefined | null): s is UiShape => isUi(s) && s.props.kind === 'screen'
export const isContainer = (s: TLShape | undefined | null): s is UiShape => isUi(s) && isContainerKind(s.props.kind)

/** Layout meta of a ui shape with kind defaults filled in. */
export function uiMeta(shape: UiShape): UiMeta {
	const m = shape.meta as Partial<UiMeta>
	return {
		...(m as object),
		sizing: { ...(KIND_DEFAULTS[shape.props.kind]?.sizing ?? { w: 'fixed', h: 'fixed' }), ...(m.sizing ?? {}) },
		...(m.layout ? { layout: m.layout } : {}),
	} as UiMeta
}

/** Children of a ui container in layout (meta.order) order. */
export function uiChildren(editor: Editor, shape: TLShape): UiShape[] {
	return editor
		.getSortedChildIdsForParent(shape.id)
		.map((id) => editor.getShape(id))
		.filter(isUi)
		.map((s, i) => ({ s, i }))
		.sort((a, b) => ((a.s.meta?.order as number) ?? a.i) - ((b.s.meta?.order as number) ?? b.i) || a.i - b.i)
		.map(({ s }) => s)
}

/** Reads a ui subtree from the editor into a resolved tree. */
export function readUiTree(editor: Editor, shape: UiShape): UiTreeNode {
	return {
		id: bareId(shape.id),
		props: { ...shape.props },
		meta: uiMeta(shape),
		x: shape.x,
		y: shape.y,
		children: uiChildren(editor, shape).map((c, i) => {
			const t = readUiTree(editor, c)
			t.meta.order = i
			return t
		}),
	}
}

/** Nearest screen ancestor (or the shape itself). */
export function screenOf(editor: Editor, shape: TLShape | undefined | null): UiShape | null {
	let cur: TLShape | undefined | null = shape
	while (cur) {
		if (isScreen(cur)) return cur
		cur = editor.getShape(cur.parentId as TLShapeId)
	}
	return null
}

export function screenTheme(shape: UiShape | null): ThemeSpec {
	const t = shape?.meta?.theme as Partial<ThemeSpec> | undefined
	return { mode: t?.mode === 'dark' ? 'dark' : 'light', primary: t?.primary || DEFAULT_THEME.primary }
}
