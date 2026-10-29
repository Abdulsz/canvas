import { useEffect, useMemo, useRef, useState } from 'react'
import { useValue, type Editor, type TLShape, type TLShapeId } from 'tldraw'
import type { CanvasExecutor } from '../agent/executor.ts'
import { CaretIcon, CloseIcon, LayersIcon } from '../components/icons.tsx'
import { bareId, isContainer, isUi, uiChildren } from '../design/tree.ts'
import { selectAndReveal } from './actions.ts'
import { KindIcon } from './KindIcon.tsx'
import { layerName } from './names.ts'

type Layer = { id: TLShapeId; kind: string; name: string; children: Layer[]; isUi: boolean; isContainer: boolean }

function toLayer(editor: Editor, shape: TLShape, screenId: string | null = null): Layer {
	const sid = screenId ?? (isUi(shape) && shape.props.kind === 'screen' ? bareId(shape.id) : null)
	return {
		id: shape.id,
		kind: isUi(shape) ? shape.props.kind : 'other',
		name: layerName(shape, sid),
		isUi: isUi(shape),
		isContainer: isContainer(shape),
		children: isContainer(shape) ? uiChildren(editor, shape).map((c) => toLayer(editor, c, sid)) : [],
	}
}

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
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
	const [renaming, setRenaming] = useState<TLShapeId | null>(null)
	const listRef = useRef<HTMLDivElement>(null)

	// Reveal the selection: expand its ancestors and scroll its row into view.
	const selectionKey = [...selected].join(',')
	useEffect(() => {
		if (!editor || !selected.size) return
		const open = new Set<string>()
		for (const id of selected) for (const a of editor.getShapeAncestors(id)) open.add(a.id)
		setCollapsed((c) => (([...open].some((id) => c.has(id)) ? new Set([...c].filter((id) => !open.has(id))) : c)))
		requestAnimationFrame(() => {
			const first = [...selected][0]
			listRef.current?.querySelector(`[data-layer-id="${CSS.escape(first)}"]`)?.scrollIntoView({ block: 'nearest' })
		})
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor, selectionKey])

	const ancestorsOfSelection = useMemo(() => {
		const out = new Set<string>()
		if (editor) for (const id of selected) for (const a of editor.getShapeAncestors(id)) out.add(a.id)
		return out
	}, [editor, selected])

	const toggle = (id: string) =>
		setCollapsed((c) => {
			const n = new Set(c)
			if (n.has(id)) n.delete(id)
			else n.add(id)
			return n
		})

	const rows: { layer: Layer; depth: number }[] = []
	const walk = (l: Layer, depth: number) => {
		rows.push({ layer: l, depth })
		if (!collapsed.has(l.id)) l.children.forEach((c) => walk(c, depth + 1))
	}
	layers.screens.forEach((l) => walk(l, 0))

	const renderRow = ({ layer, depth }: { layer: Layer; depth: number }) => {
		const isSel = selected.has(layer.id)
		const inSel = !isSel && [...selected].some((id) => editor?.hasAncestor(editor.getShape(layer.id), id as TLShapeId))
		const isHover = hovered === layer.id
		const isScreenRow = layer.kind === 'screen'
		const open = !collapsed.has(layer.id)
		return (
			<div
				key={layer.id}
				data-layer-id={layer.id}
				role="treeitem"
				aria-selected={isSel}
				aria-expanded={layer.children.length ? open : undefined}
				className={`layer-row group relative flex h-7 cursor-default select-none items-center gap-1 rounded-[6px] pr-2 text-[12px] ${
					isSel
						? 'bg-[color-mix(in_srgb,#0D99FF_16%,transparent)] text-[var(--label)]'
						: inSel
							? 'bg-[color-mix(in_srgb,#0D99FF_6%,transparent)]'
							: isHover
								? 'shadow-[inset_0_0_0_1px_#0D99FF]'
								: 'hover:shadow-[inset_0_0_0_1px_color-mix(in_srgb,#0D99FF_55%,transparent)]'
				}`}
				style={{ paddingLeft: 4 + depth * 14 }}
				onPointerEnter={() => editor?.setHoveredShape(layer.id)}
				onPointerLeave={() => editor?.setHoveredShape(null)}
				onClick={(e) => {
					if (!editor) return
					if (e.shiftKey || e.metaKey || e.ctrlKey) {
						const ids = editor.getSelectedShapeIds()
						editor.setSelectedShapes(ids.includes(layer.id) ? ids.filter((i) => i !== layer.id) : [...ids, layer.id])
					} else selectAndReveal(editor, layer.id)
				}}
				onDoubleClick={() => layer.isUi && setRenaming(layer.id)}
			>
				<button
					type="button"
					tabIndex={-1}
					aria-label={open ? 'Collapse' : 'Expand'}
					className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--label-3)] hover:text-[var(--label)] ${layer.children.length ? '' : 'invisible'}`}
					onClick={(e) => {
						e.stopPropagation()
						toggle(layer.id)
					}}
				>
					<CaretIcon className={`h-3 w-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
				</button>
				<span className={`flex h-4 w-4 shrink-0 items-center justify-center ${isSel ? 'text-[#0D99FF]' : isScreenRow ? 'text-[var(--label)]' : 'text-[var(--label-2)]'}`}>
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
							if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
							if (e.key === 'Escape') setRenaming(null)
						}}
						onBlur={(e) => {
							const name = e.target.value.trim()
							setRenaming(null)
							if (name && name !== layer.name) void exec?.run('update_node', { id: layer.id, name })
						}}
					/>
				) : (
					<span className={`min-w-0 flex-1 truncate ${isScreenRow ? 'font-semibold' : ''} ${ancestorsOfSelection.has(layer.id) && !isSel ? 'text-[var(--label)]' : ''}`} title={layer.name}>
						{layer.name}
					</span>
				)}
			</div>
		)
	}

	const count = rows.length
	return (
		<aside
			className="flex h-full w-full flex-col overflow-hidden rounded-[16px] bg-[var(--card)] md:bg-[var(--material-thick)] text-[var(--label)] shadow-[var(--shadow-panel)]"
			aria-label="Layers"
			data-testid="layers-panel"
		>
			<div className="hairline-b flex h-10 shrink-0 items-center justify-between pl-3.5 pr-2">
				<h2 className="text-[12px] font-semibold">Layers</h2>
				<div className="flex items-center gap-1">
					{count > 0 && <span className="text-[11px] tabular-nums text-[var(--label-3)]">{layers.screens.length} {layers.screens.length === 1 ? 'screen' : 'screens'}</span>}
					{onClose && (
						<button className="tap flex h-7 w-7 items-center justify-center rounded-full text-[var(--label-2)] transition-colors duration-150 hover:bg-[var(--fill)]" onClick={onClose} aria-label="Close layers">
							<CloseIcon className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
			</div>
			<div ref={listRef} className="scroll-soft min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5" role="tree" aria-label="Layer tree" onPointerLeave={() => editor?.setHoveredShape(null)}>
				{rows.length === 0 && layers.other.length === 0 && (
					<div className="flex flex-col items-center px-4 py-8 text-center">
						<span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--fill-2)] text-[var(--label-2)]">
							<LayersIcon className="h-4 w-4" />
						</span>
						<p className="mt-3 text-[12.5px] font-semibold text-[var(--label)]">No layers yet</p>
						<p className="mt-1 text-[12px] leading-relaxed text-[var(--label-2)]">Insert a screen, or ask the agent to design one.</p>
					</div>
				)}
				{rows.map(renderRow)}
				{layers.other.length > 0 && (
					<>
						<div className="mt-2 px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--label-3)]">Annotations</div>
						{layers.other.map((l) => renderRow({ layer: l, depth: 0 }))}
					</>
				)}
			</div>
		</aside>
	)
}
