import { useState, type ReactNode } from 'react'
import { useValue, type Editor, type TLShapeId } from 'tldraw'
import { DEVICES, ICONS, isContainerKind, type AlignItems, type Device, type Justify, type LayoutMode, type SizeMode, type UiNodeSpec } from '../../../shared/design.ts'
import { AGENT_NAME } from '../../../shared/protocol.ts'
import type { CanvasExecutor } from '../agent/executor.ts'
import { CodeIcon, DownloadIcon, MoonIcon, PlusIcon, SunIcon } from '../components/icons.tsx'
import { bareId, isUi, screenOf, screenTheme, uiMeta } from '../design/tree.ts'
import type { UiShape } from '../design/UiShapeUtil.tsx'
import { DEVICE_LABELS, exportPng, insertScreen, screens, selectAndReveal } from './actions.ts'
import { ColorField, NumberField, Row, Section, Segmented, Select, TextField } from './controls.tsx'
import { KIND_LABELS, KindIcon } from './KindIcon.tsx'
import { layerName } from './names.ts'

const TEXT_KINDS = new Set(['text', 'button', 'input', 'checkbox', 'avatar'])
const TEXT_COLOR_KINDS = new Set(['text', 'button', 'input', 'checkbox', 'avatar', 'icon', 'image'])
const ICON_KINDS = new Set(['icon', 'button', 'input', 'avatar', 'image'])
const CONTENT_LABEL: Record<string, string> = { text: 'Text', button: 'Label', input: 'Placeholder', checkbox: 'Label', avatar: 'Name', image: 'Caption' }
const PRIMARY_PRESETS = ['#5b5bd6', '#2563eb', '#0d9488', '#16a34a', '#ea580c', '#e11d48', '#9333ea', '#111827']

type Props = {
	editor: Editor | null
	exec: CanvasExecutor | null
	onOpenCode: (id: TLShapeId) => void
}

export function DesignPanel({ editor, exec, onOpenCode }: Props) {
	const sel = useValue(
		'design selection',
		() => {
			if (!editor) return { shape: null as UiShape | null, count: 0, nonUi: false }
			const shapes = editor.getSelectedShapes()
			const only = shapes.length === 1 && isUi(shapes[0]) ? (shapes[0] as UiShape) : null
			return { shape: only, count: shapes.length, nonUi: shapes.some((s) => !isUi(s)) }
		},
		[editor]
	)
	if (!editor || !exec) return <div className="flex-1" />
	if (sel.shape) return <NodeProperties key={sel.shape.id} editor={editor} exec={exec} shape={sel.shape} onOpenCode={onOpenCode} />
	if (sel.count > 1) {
		return (
			<Empty>
				<p className="text-[13px] font-semibold">{sel.count} layers selected</p>
				<p className="mt-1 text-[12px] leading-snug text-[var(--label-2)]">Select a single layer to edit its properties{sel.nonUi ? ', or use the style panel for sketches' : ''}.</p>
			</Empty>
		)
	}
	if (sel.count === 1) {
		return (
			<Empty>
				<p className="text-[13px] font-semibold">Sketch or annotation</p>
				<p className="mt-1 text-[12px] leading-snug text-[var(--label-2)]">Style it with the panel on the canvas. Design properties apply to screens and their layers.</p>
			</Empty>
		)
	}
	return <PageOverview editor={editor} exec={exec} />
}

function Empty({ children }: { children: ReactNode }) {
	return <div className="px-4 py-5">{children}</div>
}

function PageOverview({ editor, exec }: { editor: Editor; exec: CanvasExecutor }) {
	const list = useValue('screens', () => screens(editor).map((s) => ({ id: s.id, name: s.props.name || bareId(s.id), w: s.props.w, h: s.props.h, dark: screenTheme(s).mode === 'dark' })), [editor])
	return (
		<div className="scroll-soft min-h-0 flex-1 overflow-y-auto" data-testid="design-overview">
			<Section title="Page">
				<p className="text-[12px] leading-snug text-[var(--label-2)]">
					Select a layer on the canvas or in Layers to edit it. Or just say what you want — “make the button rounder”, “add a sign-up link”. {AGENT_NAME} edits the same file.
				</p>
			</Section>
			<Section title={`Screens · ${list.length}`}>
				{list.length === 0 && <p className="text-[12px] text-[var(--label-3)]">No screens yet.</p>}
				<div className="space-y-0.5">
					{list.map((s) => (
						<button
							key={s.id}
							className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[12px] transition-[color,background-color,box-shadow,transform] duration-150 hover:bg-[var(--fill-2)]"
							onClick={() => selectAndReveal(editor, s.id)}
						>
							<KindIcon kind="screen" className="h-3.5 w-3.5 text-[var(--label-2)]" />
							<span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
							{s.dark && <MoonIcon className="h-3 w-3 text-[var(--label-3)]" />}
							<span className="shrink-0 tabular-nums text-[11px] text-[var(--label-3)]">
								{Math.round(s.w)}×{Math.round(s.h)}
							</span>
						</button>
					))}
				</div>
			</Section>
			<Section title="New screen">
				<div className="grid grid-cols-2 gap-1.5">
					{(['iphone', 'android', 'tablet', 'desktop'] as Device[]).map((d) => (
						<button
							key={d}
							className="flex h-12 flex-col items-start justify-center rounded-[8px] bg-[var(--fill-2)] px-2.5 text-left transition-[color,background-color,box-shadow,transform] duration-150 hover:bg-[var(--fill)]"
							onClick={() => void insertScreen(editor, exec, d)}
						>
							<span className="flex items-center gap-1 text-[12px] font-medium">
								<PlusIcon className="h-3 w-3" /> {DEVICE_LABELS[d]}
							</span>
							<span className="text-[11px] tabular-nums text-[var(--label-3)]">
								{DEVICES[d].w}×{DEVICES[d].h}
							</span>
						</button>
					))}
				</div>
			</Section>
		</div>
	)
}

const SIZING_OPTIONS: { value: SizeMode; label: string }[] = [
	{ value: 'fixed', label: 'Fixed' },
	{ value: 'hug', label: 'Hug' },
	{ value: 'fill', label: 'Fill' },
]

function NodeProperties({ editor, exec, shape, onOpenCode }: { editor: Editor; exec: CanvasExecutor; shape: UiShape; onOpenCode: (id: TLShapeId) => void }) {
	const p = shape.props
	const meta = uiMeta(shape)
	const kind = p.kind
	const screen = useValue('screen of selection', () => screenOf(editor, editor.getShape(shape.id)), [editor, shape.id])
	const theme = screenTheme(screen)
	const [exporting, setExporting] = useState(false)
	const update = (patch: Partial<UiNodeSpec> & Record<string, unknown>) => void exec.run('update_node', { id: shape.id, ...patch })
	const isScreenNode = kind === 'screen'
	const container = isContainerKind(kind)
	const layout = meta.layout
	const device = (Object.keys(DEVICES) as Device[]).find((d) => DEVICES[d].w === Math.round(p.w) && DEVICES[d].h === Math.round(p.h))

	const sizeField = (axis: 'w' | 'h') => {
		const mode = meta.sizing[axis]
		const key = axis === 'w' ? 'width' : 'height'
		return (
			<div className="space-y-1">
				<NumberField label={axis.toUpperCase()} value={p[axis]} onCommit={(v) => update({ [key]: v })} title={mode === 'fixed' ? undefined : `${mode} — typing a value makes it fixed`} />
				{!isScreenNode && <Select value={mode} options={SIZING_OPTIONS} onChange={(v) => update({ [key]: v === 'fixed' ? Math.round(p[axis]) : v })} />}
			</div>
		)
	}

	return (
		<div className="scroll-soft min-h-0 flex-1 overflow-y-auto" data-testid="design-properties">
			{/* Identity */}
			<div className="hairline-b flex items-center gap-2 px-3.5 py-2.5">
				<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[color-mix(in_srgb,#0D99FF_14%,transparent)] text-[#0D99FF]">
					<KindIcon kind={kind} className="h-4 w-4" />
				</span>
				<div className="min-w-0 flex-1">
					<TextField label="Layer name" value={layerName(shape, screen ? bareId(screen.id) : null)} onCommit={(name) => update({ name })} placeholder={KIND_LABELS[kind]} />
				</div>
				<span className="shrink-0 rounded-full bg-[var(--fill-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--label-2)]">{KIND_LABELS[kind]}</span>
			</div>

			<Section title={isScreenNode ? 'Screen' : 'Size'}>
				{isScreenNode && (
					<Select
						value={device ?? 'custom'}
						options={[...(Object.keys(DEVICES) as Device[]).map((d) => ({ value: d as string, label: `${DEVICE_LABELS[d]}  ${DEVICES[d].w}×${DEVICES[d].h}` })), ...(device ? [] : [{ value: 'custom', label: 'Custom' }])]}
						onChange={(d) => DEVICES[d as Device] && update({ width: DEVICES[d as Device].w, height: DEVICES[d as Device].h })}
					/>
				)}
				<Row>
					{sizeField('w')}
					{sizeField('h')}
				</Row>
			</Section>

			{container && layout && (
				<Section title="Auto layout">
					<Segmented<LayoutMode>
						label="Direction"
						value={layout.mode}
						onChange={(v) => update({ layout: v })}
						options={[
							{ value: 'vertical', label: '↓ Vertical' },
							{ value: 'horizontal', label: '→ Horizontal' },
							{ value: 'none', label: 'Free' },
						]}
					/>
					{layout.mode !== 'none' && (
						<>
							<Row cols={3}>
								<NumberField label={<GapGlyph vertical={layout.mode === 'vertical'} />} value={layout.gap} onCommit={(gap) => update({ gap })} title="Gap between items" />
								<NumberField label="↔" value={layout.padding[3]} onCommit={(h) => update({ padding: [layout.padding[0], h, layout.padding[2], h] })} title="Horizontal padding" />
								<NumberField label="↕" value={layout.padding[0]} onCommit={(v) => update({ padding: [v, layout.padding[1], v, layout.padding[3]] })} title="Vertical padding" />
							</Row>
							<Field label="Align">
								<Segmented<AlignItems>
									label="Align items"
									value={layout.alignItems}
									onChange={(alignItems) => update({ alignItems })}
									options={[
										{ value: 'start', label: 'Start' },
										{ value: 'center', label: 'Center' },
										{ value: 'end', label: 'End' },
										{ value: 'stretch', label: 'Stretch' },
									]}
								/>
							</Field>
							<Field label="Justify">
								<Segmented<Justify>
									label="Justify content"
									value={layout.justify}
									onChange={(justify) => update({ justify })}
									options={[
										{ value: 'start', label: 'Start' },
										{ value: 'center', label: 'Center' },
										{ value: 'end', label: 'End' },
										{ value: 'space-between', label: 'Between', title: 'Space between' },
									]}
								/>
							</Field>
						</>
					)}
				</Section>
			)}

			{isScreenNode && (
				<Section title="Theme">
					<Segmented<'light' | 'dark'>
						label="Theme mode"
						value={theme.mode}
						onChange={(mode) => void exec.run('set_theme', { screenId: shape.id, mode })}
						options={[
							{ value: 'light', label: <span className="flex items-center gap-1"><SunIcon className="h-3 w-3" />Light</span> },
							{ value: 'dark', label: <span className="flex items-center gap-1"><MoonIcon className="h-3 w-3" />Dark</span> },
						]}
					/>
					<div className="flex items-center gap-2">
						<span className="w-[62px] shrink-0 text-[11px] text-[var(--label-2)]">Primary</span>
						<div className="flex flex-1 flex-wrap items-center gap-[5px]">
							{PRIMARY_PRESETS.map((c) => (
								<button
									key={c}
									type="button"
									title={c}
									aria-label={`Primary color ${c}`}
									onClick={() => void exec.run('set_theme', { screenId: shape.id, primary: c })}
									className={`rounded-full p-[1.5px] transition-[color,background-color,box-shadow,transform] duration-150 ${theme.primary.toLowerCase() === c ? 'shadow-[0_0_0_1.5px_#0D99FF]' : 'hover:shadow-[0_0_0_1.5px_var(--separator)]'}`}
								>
									<span className="block h-[16px] w-[16px] rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.14)]" style={{ background: c }} />
								</button>
							))}
							<label className="relative cursor-pointer rounded-full p-[1.5px]" title="Custom primary color">
								<span className="block h-[16px] w-[16px] rounded-full" style={{ background: 'conic-gradient(#f43f5e, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef, #f43f5e)' }} />
								<input type="color" className="sr-only" value={theme.primary.length === 7 ? theme.primary : '#5b5bd6'} onChange={(e) => void exec.run('set_theme', { screenId: shape.id, primary: e.target.value })} />
							</label>
						</div>
					</div>
				</Section>
			)}

			<Section title="Colors">
				<ColorField label="Fill" value={p.fill} theme={theme} onCommit={(fill) => update({ fill })} />
				{TEXT_COLOR_KINDS.has(kind) && <ColorField label={kind === 'icon' || kind === 'image' ? 'Icon color' : 'Text color'} value={p.textColor} theme={theme} onCommit={(textColor) => update({ textColor })} allowNone={false} />}
				{kind !== 'text' && kind !== 'divider' && (
					<>
						<ColorField label="Stroke" value={p.stroke} theme={theme} onCommit={(stroke) => update({ stroke })} />
						{p.stroke !== 'transparent' && (
							<div className="pl-[70px]">
								<NumberField label="W" value={p.strokeWidth} onCommit={(strokeWidth) => update({ strokeWidth })} title="Stroke width" suffix="px" />
							</div>
						)}
					</>
				)}
			</Section>

			<Section title="Appearance">
				<Row>
					{kind !== 'avatar' && kind !== 'text' && kind !== 'divider' ? (
						<NumberField label={<RadiusGlyph />} value={p.radius} onCommit={(radius) => update({ radius })} title="Corner radius" />
					) : (
						<div />
					)}
					<NumberField label={<OpacityGlyph />} value={Math.round(p.opacity * 100)} max={100} onCommit={(v) => update({ opacity: v / 100 })} title="Opacity" suffix="%" />
				</Row>
				<Select
					label="Shadow"
					value={p.shadow}
					onChange={(shadow) => update({ shadow })}
					options={[
						{ value: 'none', label: 'None' },
						{ value: 'sm', label: 'Small' },
						{ value: 'md', label: 'Medium' },
						{ value: 'lg', label: 'Large' },
					]}
				/>
			</Section>

			{TEXT_KINDS.has(kind) && (
				<Section title="Typography">
					<Row>
						<NumberField label="Aa" value={p.fontSize} min={6} onCommit={(fontSize) => update({ fontSize })} title="Font size" />
						<Select
							value={p.fontWeight}
							onChange={(fontWeight) => update({ fontWeight })}
							options={[
								{ value: 300, label: 'Light' },
								{ value: 400, label: 'Regular' },
								{ value: 500, label: 'Medium' },
								{ value: 600, label: 'Semibold' },
								{ value: 700, label: 'Bold' },
							]}
						/>
					</Row>
					{(kind === 'text' || kind === 'button') && (
						<Segmented
							label="Text align"
							value={p.align}
							onChange={(align) => update({ align })}
							options={[
								{ value: 'left', label: 'Left' },
								{ value: 'center', label: 'Center' },
								{ value: 'right', label: 'Right' },
							]}
						/>
					)}
				</Section>
			)}

			{(CONTENT_LABEL[kind] || ICON_KINDS.has(kind) || kind === 'toggle' || kind === 'checkbox') && (
				<Section title="Content">
					{CONTENT_LABEL[kind] && (
						<Field label={CONTENT_LABEL[kind]}>
							<TextField label={CONTENT_LABEL[kind]} value={p.text} multiline={kind === 'text'} onCommit={(text) => update({ text })} />
						</Field>
					)}
					{ICON_KINDS.has(kind) && (
						<Field label="Icon">
							<Select
								value={p.icon || ''}
								onChange={(icon) => update({ icon })}
								options={[...(kind === 'icon' ? [] : [{ value: '', label: 'None' }]), ...ICONS.map((i) => ({ value: i, label: i }))]}
							/>
						</Field>
					)}
					{(kind === 'toggle' || kind === 'checkbox') && (
						<Field label="State">
							<Segmented<'on' | 'off'>
								label="Checked"
								value={p.checked ? 'on' : 'off'}
								onChange={(v) => update({ checked: v === 'on' })}
								options={[
									{ value: 'on', label: 'On' },
									{ value: 'off', label: 'Off' },
								]}
							/>
						</Field>
					)}
				</Section>
			)}

			<Section title="Export">
				<p className="-mt-0.5 text-[11px] text-[var(--label-3)]">{isScreenNode ? 'This screen' : `This ${KIND_LABELS[kind].toLowerCase()} and its layers`}</p>
				<Row>
					<button
						className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-[var(--accent)] text-[12px] font-semibold text-[var(--on-accent)] transition-[color,background-color,box-shadow,transform] duration-150 hover:bg-[var(--accent-hover)] active:scale-[0.98]"
						onClick={() => onOpenCode(shape.id)}
					>
						<CodeIcon className="h-3.5 w-3.5" /> Copy code
					</button>
					<button
						className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-[var(--fill)] text-[12px] font-medium text-[var(--label)] transition-[color,background-color,box-shadow,transform] duration-150 hover:bg-[var(--fill-2)] active:scale-[0.98] disabled:opacity-50"
						disabled={exporting}
						onClick={async () => {
							setExporting(true)
							try {
								await exportPng(editor, shape.id)
							} finally {
								setExporting(false)
							}
						}}
					>
						<DownloadIcon className="h-3.5 w-3.5" /> {exporting ? 'Exporting…' : 'PNG @2x'}
					</button>
				</Row>
				{!isScreenNode && screen && (
					<button className="text-[11px] font-medium text-[#0D99FF] hover:underline" onClick={() => onOpenCode(screen.id)}>
						Code for the whole screen
					</button>
				)}
			</Section>
		</div>
	)
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-center gap-2">
			<span className="w-[62px] shrink-0 text-[11px] text-[var(--label-2)]">{label}</span>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	)
}

function GapGlyph({ vertical }: { vertical: boolean }) {
	return (
		<svg viewBox="0 0 12 12" className={`h-3 w-3 ${vertical ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" strokeWidth="1.2">
			<path d="M1.5 1.5h9 M1.5 10.5h9 M6 4v4" />
		</svg>
	)
}


function RadiusGlyph() {
	return (
		<svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.2">
			<path d="M1.5 10.5V6a4.5 4.5 0 0 1 4.5-4.5h4.5" />
		</svg>
	)
}

function OpacityGlyph() {
	return (
		<svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.2">
			<circle cx="6" cy="6" r="4.5" />
			<path d="M6 1.5a4.5 4.5 0 0 1 0 9z" fill="currentColor" />
		</svg>
	)
}
