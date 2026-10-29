import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useValue, type Editor, type TLShape, type TLShapeId } from 'tldraw'
import type { CanvasExecutor } from '../agent/executor.ts'
import { CaretIcon, CloseIcon, LayersIcon } from '../components/icons.tsx'
import { bareId, isContainer, isUi, uiChildren } from '../design/tree.ts'
import { selectAndReveal } from './actions.ts'
import { KindIcon } from './KindIcon.tsx'
import { layerName } from './names.ts'

type Layer = { id: TLShapeId; kind: string; name: string; children: Layer[]; isUi: boolean; helper: boolean }
type Row = { layer: Layer; depth: number; parent: TLShapeId | null; open: boolean }

/** Structural helpers (icons, dividers, empty spacers) are real layers but visual noise: they render dimmed. */
function isHelper(kind: string, name: string, childCount: number) {
	if (kind === 'icon' || kind === 'divider') return true
	return (kind === 'frame' || kind === 'rect') && childCount === 0 && /spacer|gap|filler/i.test(name)
}

function toLayer(editor: Editor, shape: TLShape, screenId: string | null = null): Layer {
	const sid = screenId ?? (isUi(shape) && shape.props.kind === 'screen' ? bareId(shape.id) : null)
	const kind = isUi(shape) ? shape.props.kind : 'other'
	const name = layerName(shape, sid)
	const children = isContainer(shape) ? uiChildren(editor, shape).map((c) => toLayer(editor, c, sid)) : []
	return { id: shape.id, kind, name, isUi: isUi(shape), children, helper: isHelper(kind, name, children.length) }
}

/**
 * Layer tree. Screens open one level by default and everything deeper stays
 * collapsed except the path to the selection, so a 170-node design reads as a
 * short outline. role=tree with roving focus: arrows move, Right/Left open and
 * close, Enter selects, F2 renames.
 */
export function LayersPanel({ editor, exec, onClose }: { editor: Editor | null; exec: CanvasExecutor | null; onClose?: () => void }) {
	const layers = useValue(
		'layers',
		() => {
			if (!editor) return { screens: [] as Layer[], other: [] as Layer[] }
			const top = editor.getSortedChildIdsForParent(editor.getCurrentPageId()).map((id) => editor.getShape(id)!).filter(Boolean)
			const ui = top.filter(isUi).sort((a, b) => a.x - b.x || a.y - b.y)
			return { screens: ui.map((s) => toLayer(editor, s)), other: top.filter((s) => !isUi(s)).map((s) => toLayer(editor, s)) }
		},
		[editor]
	)
	const selected = useValue('selected ids', () => new Set(editor?.getSelectedShapeIds() ?? []), [editor])
	const hovered = useValue('hovered id', () => editor?.getHoveredShapeId() ?? null, [editor])
	// Explicit open/closed choices; anything not listed follows the default.
	const [openState, setOpenState] = useState<Map<string, boolean>>(() => new Map())
	const [renaming, setRenaming] = useState<TLShapeId | null>(null)
	const [focusId, setFocusId] = useState<TLShapeId | null>(null)
	const listRef = useRef<HTMLDivElement>(null)

	const selectionKey = [...selected].join(',')
	const ancestorsOfSelection = useMemo(() => {
		const out = new Set<string>()
		if (editor) for (const id of selected) for (const a of editor.getShapeAncestors(id)) out.add(a.id)
		return out
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor, selectionKey])

	// A new selection re-opens its path (dropping any explicit "closed" on it) and scrolls its row into view.
	useEffect(() => {
		if (!editor || !selected.size) return
		setOpenState((m) => {
			if (![...ancestorsOfSelection].some((id) => m.get(id) === false)) return m
			const n = new Map(m)
			for (const id of ancestorsOfSelection) n.delete(id)
			return n
		})
		const first = [...selected][0]
		setFocusId(first)
		requestAnimationFrame(() => listRef.current?.querySelector(`[data-layer-id="${CSS.escape(first)}"]`)?.scrollIntoView({ block: 'nearest' }))
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor, selectionKey])

	const isOpen = (l: Layer, depth: number) => openState.get(l.id) ?? (depth === 0 || ancestorsOfSelection.has(l.id))
	const setOpen = (id: string, open: boolean) =>
		setOpenState((m) => {
			const n = new Map(m)
			n.set(id, open)
			return n
		})

	const rows: Row[] = []
	const walk = (l: Layer, depth: number, parent: TLShapeId | null) => {
		const open = l.children.length > 0 && isOpen(l, depth)
		rows.push({ layer: l, depth, parent, open })
		if (open) l.children.forEach((c) => walk(c, depth + 1, l.id))
	}
	layers.screens.forEach((l) => walk(l, 0, null))
	layers.other.forEach((l) => rows.push({ layer: l, depth: 0, parent: null, open: false }))
	const tabStop = rows.some((r) => r.layer.id === focusId) ? focusId : (rows.find((r) => selected.has(r.layer.id)) ?? rows[0])?.layer.id

	// Arrow keys move focus and the selection with it (single-select tree), like Figma's layer list.
	const focusRow = (id: TLShapeId | null | undefined, follow = true) => {
		if (!id) return
		setFocusId(id)
		if (follow && editor && !editor.getSelectedShapeIds().includes(id)) select(id)
		requestAnimationFrame(() => (listRef.current?.querySelector(`[data-layer-id="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus())
	}
	const select = (id: TLShapeId) => editor && selectAndReveal(editor, id)

	const onKeyDown = (e: KeyboardEvent, row: Row, index: number) => {
		if (renaming) return
		const { layer } = row
		const handled = () => {
			e.preventDefault()
			e.stopPropagation()
		}
		switch (e.key) {
			case 'ArrowDown':
				handled()
				focusRow(rows[Math.min(rows.length - 1, index + 1)]?.layer.id)
				break
			case 'ArrowUp':
				handled()
				focusRow(rows[Math.max(0, index - 1)]?.layer.id)
				break
			case 'Home':
				handled()
				focusRow(rows[0]?.layer.id)
				break
			case 'End':
				handled()
				focusRow(rows[rows.length - 1]?.layer.id)
				break
			case 'ArrowRight':
				handled()
				if (!layer.children.length) break
				if (!row.open) setOpen(layer.id, true)
				else focusRow(layer.children[0].id)
				break
			case 'ArrowLeft':
				handled()
				if (row.open) setOpen(layer.id, false)
				else focusRow(row.parent)
				break
			case 'Escape':
				handled()
				editor?.selectNone()
				break
			case 'Enter':
			case ' ':
				handled()
				select(layer.id)
				break
			case 'F2':
				handled()
				if (layer.isUi) setRenaming(layer.id)
				break
		}
	}

	const renderRow = (row: Row, index: number) => {
		const { layer, depth } = row
		const isSel = selected.has(layer.id)
		const inSel = !isSel && [...selected].some((id) => editor?.hasAncestor(editor.getShape(layer.id), id as TLShapeId))
		const isHover = hovered === layer.id
		const isScreenRow = layer.kind === 'screen'
		return (
			<div
				key={layer.id}
				data-layer-id={layer.id}
				role="treeitem"
				aria-level={depth + 1}
				aria-selected={isSel}
				aria-expanded={layer.children.length ? row.open : undefined}
				aria-label={layer.name}
				tabIndex={layer.id === tabStop ? 0 : -1}
				className={`layer-row group relative flex h-7 cursor-default select-none items-center gap-1 rounded-[6px] pr-2 text-[12px] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--focus)] ${
					isSel
						? 'bg-[color-mix(in_srgb,#0D99FF_16%,transparent)] text-[var(--label)]'
						: inSel
							? 'bg-[color-mix(in_srgb,#0D99FF_6%,transparent)]'
							: isHover
								? 'shadow-[inset_0_0_0_1px_#0D99FF]'
								: 'hover:shadow-[inset_0_0_0_1px_color-mix(in_srgb,#0D99FF_55%,transparent)]'
				} ${isScreenRow && index > 0 ? 'mt-1' : ''}`}
				style={{ paddingLeft: 4 + depth * 12 }}
				onPointerEnter={() => editor?.setHoveredShape(layer.id)}
				onPointerLeave={() => editor?.setHoveredShape(null)}
				onFocus={() => setFocusId(layer.id)}
				onKeyDown={(e) => onKeyDown(e, row, index)}
				onClick={(e) => {
					if (!editor) return
					if (e.shiftKey || e.metaKey || e.ctrlKey) {
						const ids = editor.getSelectedShapeIds()
						editor.setSelectedShapes(ids.includes(layer.id) ? ids.filter((i) => i !== layer.id) : [...ids, layer.id])
					} else select(layer.id)
				}}
				onDoubleClick={() => layer.isUi && setRenaming(layer.id)}
			>
				{/* Disclosure caret: pointer shortcut only (keyboard uses Right/Left on the row, which carries aria-expanded). */}
				<span
					aria-hidden
					className={`flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-[var(--label-2)] transition-colors duration-150 hover:bg-[var(--fill)] hover:text-[var(--label)] active:bg-[var(--press)] max-md:h-9 max-md:w-9 ${layer.children.length ? '' : 'invisible'}`}
					onClick={(e) => {
						e.stopPropagation()
						setOpen(layer.id, !row.open)
					}}
				>
					<CaretIcon className={`h-3 w-3 transition-transform duration-150 ${row.open ? 'rotate-90' : ''}`} />
				</span>
				<span
					className={`flex h-4 w-4 shrink-0 items-center justify-center ${isSel ? 'text-[var(--link)]' : isScreenRow ? 'text-[var(--label)]' : layer.helper ? 'text-[var(--label-3)] opacity-70' : 'text-[var(--label-2)]'}`}
				>
					<KindIcon kind={layer.kind} />
				</span>
				{renaming === layer.id ? (
					<input
						autoFocus
						defaultValue={layer.name}
						aria-label="Layer name"
						className="h-[22px] min-w-0 flex-1 rounded-[4px] bg-[var(--card)] px-1 text-[12px] outline-none shadow-[inset_0_0_0_1px_#0D99FF] focus-visible:outline-none"
						onFocus={(e) => e.target.select()}
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => {
							e.stopPropagation()
							if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
							if (e.key === 'Escape') {
								setRenaming(null)
								focusRow(layer.id)
							}
						}}
						onBlur={(e) => {
							const name = e.target.value.trim()
							setRenaming(null)
							if (name && name !== layer.name) void exec?.run('update_node', { id: layer.id, name })
						}}
					/>
				) : (
					<span
						className={`min-w-0 flex-1 truncate ${isScreenRow ? 'font-semibold' : ''} ${
							isSel || (ancestorsOfSelection.has(layer.id) && !isSel) ? 'text-[var(--label)]' : layer.helper ? 'text-[var(--label-3)]' : ''
						}`}
						title={layer.name}
					>
						{layer.name}
					</span>
				)}
				{!row.open && layer.children.length > 0 && !isScreenRow && (
					<span className="shrink-0 text-[12px] tabular-nums text-[var(--label-3)] opacity-0 transition-opacity duration-150 group-hover:opacity-100" aria-hidden>
						{layer.children.length}
					</span>
				)}
			</div>
		)
	}

	const screenCount = layers.screens.length
	const anyOpen = rows.some((r) => r.depth > 0 && r.open)
	return (
		<aside
			className="flex h-full w-full flex-col overflow-hidden rounded-[16px] bg-[var(--card)] text-[var(--label)] shadow-[var(--shadow-panel)] md:bg-[var(--material-thick)]"
			aria-label="Layers"
			data-testid="layers-panel"
		>
			<div className="hairline-b flex h-11 shrink-0 items-center justify-between pl-3.5 pr-2 md:h-10">
				<h2 className="text-[13px] font-semibold md:text-[12px]">Layers</h2>
				<div className="flex items-center gap-1">
					{screenCount > 0 && (
						<span className="text-[12px] tabular-nums text-[var(--label-3)]">
							{screenCount} {screenCount === 1 ? 'screen' : 'screens'}
						</span>
					)}
					{anyOpen && (
						<button
							type="button"
							className="tap ml-1 h-8 rounded-[7px] px-2 text-[12px] font-medium max-md:h-11 max-md:px-3 text-[var(--label-2)] transition-colors duration-150 hover:bg-[var(--fill)] hover:text-[var(--label)]"
							onClick={() => setOpenState(new Map(rows.filter((r) => r.depth > 0 && r.open).map((r) => [r.layer.id, false])))}
							title="Collapse all groups"
						>
							Collapse
						</button>
					)}
					{onClose && (
						<button className="tap flex h-11 w-11 items-center justify-center rounded-full text-[var(--label-2)] transition-colors duration-150 hover:bg-[var(--fill)] active:bg-[var(--press)]" onClick={onClose} aria-label="Close layers">
							<CloseIcon className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
			</div>
			<div ref={listRef} className="scroll-soft min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5" role="tree" aria-label="Layer tree" onPointerLeave={() => editor?.setHoveredShape(null)}>
				{rows.length === 0 && (
					<div className="flex flex-col items-center px-4 py-8 text-center">
						<span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--fill-2)] text-[var(--label-2)]">
							<LayersIcon className="h-4 w-4" />
						</span>
						<p className="mt-3 text-[13px] font-semibold text-[var(--label)]">No layers yet</p>
						<p className="mt-1 text-[12px] leading-relaxed text-[var(--label-2)]">Insert a screen, or ask the agent to design one.</p>
					</div>
				)}
				{rows.map((r, i) =>
					layers.other.length > 0 && r.layer === layers.other[0] ? (
						<div key={`annotations-${r.layer.id}`} role="none">
							<div className="mt-2 px-2 pb-1 pt-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--label-3)]" role="none">
								Annotations
							</div>
							{renderRow(r, i)}
						</div>
					) : (
						renderRow(r, i)
					)
				)}
			</div>
		</aside>
	)
}
