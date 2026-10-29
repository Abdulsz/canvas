import { useState } from 'react'
import { useValue, type Editor, type TLShapeId } from 'tldraw'
import { DEVICES, type Device } from '../../../shared/design.ts'
import type { Participant } from '../../../shared/protocol.ts'
import type { CanvasExecutor } from '../agent/executor.ts'
import { Avatar } from '../components/AgentPanel.tsx'
import { CheckIcon, CodeIcon, DownloadIcon, FileIcon, LayersIcon, LinkIcon, PlusIcon, ScreenThemeIcon } from '../components/icons.tsx'
import { screenTheme } from '../design/tree.ts'
import type { Identity } from '../identity.ts'
import { activeScreen, COMPONENTS, DEVICE_LABELS, exportPng, insertComponent, insertScreen } from './actions.ts'
import { MenuItem, menuPanel, usePopover } from './controls.tsx'
import { KindIcon, RoleIcon } from './KindIcon.tsx'

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
		<header
			className="relative z-[500] flex h-[calc(52px+env(safe-area-inset-top))] shrink-0 items-center gap-1.5 bg-[var(--bg)] pl-[max(8px,env(safe-area-inset-left))] pr-[max(8px,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] md:h-12 md:gap-2 md:px-3"
			data-testid="top-bar"
		>
			{/* Left: layers toggle (mobile), product mark, file name */}
			<button
				className={`tap flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] transition-colors duration-150 md:hidden ${layersOpen ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'text-[var(--label-2)] hover:bg-[var(--fill)] active:bg-[var(--press)]'}`}
				onClick={onToggleLayers}
				aria-label="Layers"
				aria-pressed={layersOpen}
			>
				<LayersIcon className="h-[18px] w-[18px]" />
			</button>
			<div className="flex min-w-0 items-center gap-2.5">
				<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--accent)] text-[var(--on-accent)] max-[479px]:hidden" aria-hidden>
					<svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
						<path d="M5.5 2.5v11 M10.5 2.5v11 M2.5 5.5h11 M2.5 10.5h11" />
					</svg>
				</div>
				<div className="flex min-w-0 items-center gap-1.5 text-[13px] max-[479px]:sr-only">
					<span className="hidden text-[var(--label-3)] lg:inline">Grok Design</span>
					<span className="hidden text-[var(--label-3)] lg:inline">/</span>
					<FileIcon className="h-3.5 w-3.5 shrink-0 text-[var(--label-2)] lg:hidden" aria-hidden />
					<span className="truncate font-semibold tracking-[-0.01em]" title={`Room ${roomId}`} data-testid="file-name">
						{roomId}
					</span>
				</div>
			</div>

			{/* Center: insert */}
			<div className="flex flex-1 justify-center">
				<div ref={insert.ref} className="relative">
					<button
						className={`tap flex h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.97] md:h-8 md:px-3.5 md:text-[13px] ${
							insert.open ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'bg-[var(--card)] text-[var(--label)] shadow-[var(--shadow-control)] hover:bg-[var(--fill-2)]'
						}`}
						onClick={() => insert.setOpen(!insert.open)}
						aria-haspopup="menu"
						aria-expanded={insert.open}
						disabled={!editor}
					>
						<PlusIcon className="h-3.5 w-3.5" /> Insert
					</button>
					{insert.open && editor && exec && <span className="menu-arrow pop max-md:hidden" aria-hidden />}
					{insert.open && editor && exec && (
						<div
							className={`${menuPanel} scroll-soft left-1/2 w-[392px] max-w-[calc(100vw-24px)] -translate-x-1/2 overflow-y-auto max-md:fixed max-md:inset-x-3 max-md:top-[calc(56px+env(safe-area-inset-top))] max-md:mt-0 max-md:max-h-[calc(100dvh-72px-env(safe-area-inset-top))] max-md:w-auto max-md:max-w-none max-md:translate-x-0`}
							role="menu"
							aria-label="Insert"
						>
							<div className="px-2.5 pb-1.5 pt-1 text-[12px] font-semibold text-[var(--label)]">Screens</div>
							<div className="grid grid-cols-2 gap-1 max-[480px]:grid-cols-1">
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
							<div className="mx-2 my-2 h-px bg-[var(--separator)]" />
							<div className="px-2.5 pb-2 pt-0.5">
								<div className="text-[12px] font-semibold text-[var(--label)]">Components</div>
								<div className="mt-0.5 text-[12px] leading-snug text-[var(--label-2)]">Added to the selected screen or frame</div>
							</div>
							<div className="grid grid-cols-3 gap-1 max-[420px]:grid-cols-2">
								{COMPONENTS.map((c) => (
									<button
										key={c.key}
										role="menuitem"
										className="flex h-[64px] flex-col items-center justify-center gap-1.5 rounded-[10px] text-[12px] font-medium text-[var(--label)] transition-[background-color,transform] duration-150 hover:bg-[var(--fill)] active:scale-[0.97] active:bg-[var(--press)]"
										onClick={() => {
											insert.setOpen(false)
											void insertComponent(editor, exec, c.key)
										}}
									>
										<span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[var(--fill)] text-[var(--label)]" aria-hidden>
											{c.key === 'navbar' || c.key === 'listItem' || c.key === 'card' ? (
												<RoleIcon role={c.key === 'navbar' ? 'header' : c.key === 'listItem' ? 'list' : 'card'} className="h-4 w-4" />
											) : (
												<KindIcon kind={c.kind} className="h-4 w-4" />
											)}
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
			<div className="flex items-center gap-1 md:gap-1.5">
				<div className="mr-1 hidden -space-x-1.5 md:flex" data-testid="top-participants" title={[me.name, ...others.map((o) => o.name)].join(', ')}>
					<Avatar name={me.name} color={me.color} ring />
					{others.slice(0, 3).map((p) => (
						<Avatar key={p.userId} name={p.name} color={p.color} ring />
					))}
				</div>
				{/* Theme of the selected screen: a design property, not the app's appearance (the shell follows the OS). */}
				<button
					className="tap flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium text-[var(--label-2)] transition-colors duration-150 hover:bg-[var(--fill)] hover:text-[var(--label)] active:bg-[var(--press)] disabled:opacity-40 disabled:hover:bg-transparent md:h-8 md:min-w-8 lg:px-2.5"
					disabled={!target}
					onClick={() => target && void exec?.run('set_theme', { screenId: target.id, mode: target.mode === 'dark' ? 'light' : 'dark' })}
					title={
						target
							? `Screen theme: ${target.mode === 'dark' ? 'Dark' : 'Light'}. Click to switch “${target.name}” to ${target.mode === 'dark' ? 'light' : 'dark'}. The app itself follows your system appearance.`
							: 'Screen theme (select a screen)'
					}
					aria-label={target ? `Screen theme: ${target.mode === 'dark' ? 'Dark' : 'Light'}` : 'Screen theme'}
					data-testid="screen-theme"
				>
					<ScreenThemeIcon dark={target?.mode === 'dark'} className="h-[18px] w-[18px]" />
					<span className="hidden lg:inline" aria-hidden>
						{target?.mode === 'dark' ? 'Dark screen' : 'Light screen'}
					</span>
				</button>
				<div ref={exportMenu.ref} className="relative">
					<button
						className="tap flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-[var(--label)] transition-colors duration-150 hover:bg-[var(--fill)] active:bg-[var(--press)] disabled:opacity-40 md:h-8 md:min-w-8"
						aria-label="Export"
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
							<div className="truncate px-2.5 pb-1.5 pt-1 text-[12px] font-semibold text-[var(--label)]">{target.name}</div>
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
					className="tap flex h-11 items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-[14px] font-semibold text-[var(--on-accent)] transition-[background-color,transform] duration-150 hover:bg-[var(--accent-hover)] active:scale-[0.97] md:h-8 md:px-3.5 md:text-[13px]"
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
