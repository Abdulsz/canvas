import { useState } from 'react'
import { useValue, type Editor, type TLShapeId } from 'tldraw'
import { DEVICES, type Device } from '../../../shared/design.ts'
import type { Participant } from '../../../shared/protocol.ts'
import type { CanvasExecutor } from '../agent/executor.ts'
import { Avatar } from '../components/AgentPanel.tsx'
import { CheckIcon, CodeIcon, DownloadIcon, FileIcon, LayersIcon, LinkIcon, MoonIcon, PlusIcon, SunIcon } from '../components/icons.tsx'
import { screenTheme } from '../design/tree.ts'
import type { Identity } from '../identity.ts'
import { activeScreen, COMPONENTS, DEVICE_LABELS, exportPng, insertComponent, insertScreen } from './actions.ts'
import { MenuItem, menuPanel, usePopover } from './controls.tsx'
import { KindIcon } from './KindIcon.tsx'

type Props = {
	roomId: string
	me: Identity
	participants: Participant[]
	editor: Editor | null
	exec: CanvasExecutor | null
	onOpenCode: (id: TLShapeId) => void
	onToggleLayers: () => void
	layersOpen: boolean
}

export function TopBar({ roomId, me, participants, editor, exec, onOpenCode, onToggleLayers, layersOpen }: Props) {
	const insert = usePopover()
	const exportMenu = usePopover()
	const [copied, setCopied] = useState(false)
	const target = useValue(
		'active screen',
		() => {
			const s = editor ? activeScreen(editor) : null
			return s ? { id: s.id, name: s.props.name, mode: screenTheme(s).mode } : null
		},
		[editor]
	)
	const others = participants.filter((p) => p.userId !== me.userId)

	return (
		<header className="relative z-[500] flex h-12 shrink-0 items-center gap-2 px-2.5 md:px-3" data-testid="top-bar">
			{/* Left: layers toggle (mobile), product mark, file name */}
			<button
				className={`tap flex h-8 w-8 items-center justify-center rounded-[8px] transition md:hidden ${layersOpen ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'text-[var(--label-2)] hover:bg-[var(--fill)]'}`}
				onClick={onToggleLayers}
				aria-label="Layers"
				aria-pressed={layersOpen}
			>
				<LayersIcon className="h-4 w-4" />
			</button>
			<div className="flex min-w-0 items-center gap-2.5">
				<div className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--accent)] text-[var(--on-accent)] sm:flex" aria-hidden>
					<svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
						<path d="M5.5 2.5v11 M10.5 2.5v11 M2.5 5.5h11 M2.5 10.5h11" />
					</svg>
				</div>
				<div className="flex min-w-0 items-center gap-1.5 text-[13px]">
					<span className="hidden text-[var(--label-3)] lg:inline">Grok Design</span>
					<span className="hidden text-[var(--label-3)] lg:inline">/</span>
					<FileIcon className="h-3.5 w-3.5 shrink-0 text-[var(--label-2)] lg:hidden" />
					<span className="truncate font-semibold tracking-[-0.01em]" title={`Room ${roomId}`} data-testid="file-name">
						{roomId}
					</span>
				</div>
			</div>

			{/* Center: insert */}
			<div className="flex flex-1 justify-center">
				<div ref={insert.ref} className="relative">
					<button
						className={`tap flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition active:scale-[0.97] ${
							insert.open ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'bg-[var(--card)] text-[var(--label)] shadow-[var(--shadow-control)] hover:bg-[var(--fill-2)]'
						}`}
						onClick={() => insert.setOpen(!insert.open)}
						aria-haspopup="menu"
						aria-expanded={insert.open}
						disabled={!editor}
					>
						<PlusIcon className="h-3.5 w-3.5" /> Insert
					</button>
					{insert.open && editor && exec && (
						<div className={`${menuPanel} left-1/2 w-[372px] max-w-[calc(100vw-24px)] -translate-x-1/2`} role="menu" aria-label="Insert">
							<div className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--label-3)]">Screens</div>
							<div className="grid grid-cols-2 gap-0.5">
								{(Object.keys(DEVICES) as Device[]).map((d) => (
									<MenuItem
										key={d}
										icon={<KindIcon kind="screen" />}
										label={DEVICE_LABELS[d]}
										hint={`${DEVICES[d].w}×${DEVICES[d].h}`}
										onClick={() => {
											insert.setOpen(false)
											void insertScreen(editor, exec, d)
										}}
									/>
								))}
							</div>
							<div className="mx-2 my-1.5 h-px bg-[var(--separator)]" />
							<div className="flex items-baseline justify-between px-2 pb-1 pt-0.5">
								<span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--label-3)]">Components</span>
								<span className="text-[10.5px] text-[var(--label-3)]">into the selected screen or frame</span>
							</div>
							<div className="grid grid-cols-3 gap-1">
								{COMPONENTS.map((c) => (
									<button
										key={c.key}
										role="menuitem"
										className="flex h-[58px] flex-col items-center justify-center gap-1.5 rounded-[9px] text-[12px] text-[var(--label)] transition hover:bg-[var(--fill)]"
										onClick={() => {
											insert.setOpen(false)
											void insertComponent(editor, exec, c.key)
										}}
									>
										<span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[var(--fill-2)] text-[var(--label-2)]">
											<KindIcon kind={c.key === 'card' ? 'rect' : c.key === 'navbar' || c.key === 'listItem' ? 'frame' : c.kind} className="h-4 w-4" />
										</span>
										{c.label}
									</button>
								))}
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Right: people, theme, export, invite */}
			<div className="flex items-center gap-1.5">
				<div className="mr-1 hidden -space-x-1.5 sm:flex" data-testid="top-participants" title={[me.name, ...others.map((o) => o.name)].join(', ')}>
					<Avatar name={me.name} color={me.color} ring />
					{others.slice(0, 3).map((p) => (
						<Avatar key={p.userId} name={p.name} color={p.color} ring />
					))}
				</div>
				<button
					className="tap flex h-8 w-8 items-center justify-center rounded-full text-[var(--label-2)] transition hover:bg-[var(--fill)] hover:text-[var(--label)] disabled:opacity-35 disabled:hover:bg-transparent"
					disabled={!target}
					onClick={() => target && void exec?.run('set_theme', { screenId: target.id, mode: target.mode === 'dark' ? 'light' : 'dark' })}
					title={target ? `Switch “${target.name}” to ${target.mode === 'dark' ? 'light' : 'dark'} mode` : 'Theme (select a screen)'}
					aria-label="Toggle screen theme"
				>
					{target?.mode === 'dark' ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
				</button>
				<div ref={exportMenu.ref} className="relative">
					<button
						className="tap flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-[var(--label)] transition hover:bg-[var(--fill)] disabled:opacity-35"
						onClick={() => exportMenu.setOpen(!exportMenu.open)}
						disabled={!target}
						aria-haspopup="menu"
						aria-expanded={exportMenu.open}
					>
						<DownloadIcon className="h-3.5 w-3.5" />
						<span className="hidden sm:inline">Export</span>
					</button>
					{exportMenu.open && editor && target && (
						<div className={`${menuPanel} right-0 w-[230px]`} role="menu" aria-label="Export">
							<div className="truncate px-2 pb-1 pt-1 text-[11px] text-[var(--label-3)]">{target.name}</div>
							<MenuItem
								icon={<CodeIcon className="h-4 w-4" />}
								label="Copy code"
								hint="HTML/CSS"
								onClick={() => {
									exportMenu.setOpen(false)
									onOpenCode(target.id)
								}}
							/>
							<MenuItem
								icon={<DownloadIcon className="h-4 w-4" />}
								label="Export PNG"
								hint="@2x"
								onClick={() => {
									exportMenu.setOpen(false)
									void exportPng(editor, target.id)
								}}
							/>
						</div>
					)}
				</div>
				<button
					className="tap flex h-8 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 text-[13px] font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-hover)] active:scale-[0.97]"
					onClick={() => {
						void navigator.clipboard?.writeText(location.href).catch(() => {})
						setCopied(true)
						setTimeout(() => setCopied(false), 1600)
					}}
					title={`Copy link to ${roomId}`}
				>
					{copied ? <CheckIcon className="h-3.5 w-3.5" /> : <LinkIcon className="h-3.5 w-3.5" />}
					{copied ? 'Copied' : 'Invite'}
				</button>
			</div>
		</header>
	)
}
