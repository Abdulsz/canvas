import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import { useSync } from '@tldraw/sync'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
	atom,
	type Box,
	createUserId,
	DefaultStylePanel,
	DEFAULT_THEME,
	setUserPreferences,
	Tldraw,
	useEditor,
	useValue,
	UserRecordType,
	type Editor,
	type TLAssetStore,
	type TLShapeId,
	type TLComponents,
	type TLUiOverrides,
	type TLUiStylePanelProps,
	type TLThemes,
} from 'tldraw'
import { AGENT_NAME } from '../../shared/protocol.ts'
import { registerAuthorship } from './agent/authorship.ts'
import { fitBounds } from './agent/layout.ts'
import { CanvasExecutor } from './agent/executor.ts'
import { useAgent } from './agent/useAgent.ts'
import { useVoice } from './agent/useVoice.ts'
import { AgentPanel, ConfirmDialog, Orb } from './components/AgentPanel.tsx'
import { EmptyCanvas } from './shell/EmptyCanvas.tsx'
import { customShapeUtils, syncShapeUtils } from './design/shapes.ts'
import { isUi } from './design/tree.ts'
import type { Identity } from './identity.ts'
import { CodeModal } from './shell/CodeModal.tsx'
import { DesignPanel } from './shell/DesignPanel.tsx'
import { LayersPanel } from './shell/LayersPanel.tsx'
import { TopBar } from './shell/TopBar.tsx'
import { VoiceDock } from './shell/VoiceDock.tsx'

const assets: TLAssetStore = {
	async upload(_asset, file) {
		const name = `${crypto.randomUUID()}-${file.name}`.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 200)
		const res = await fetch(`/api/uploads/${name}`, { method: 'PUT', body: file })
		if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
		return { src: `/api/uploads/${name}` }
	},
	resolve: (asset) => asset.props.src,
}

const AgentCursorContext = createContext<{ x: number; y: number } | null>(null)

/** The agent's presence cursor, drawn over the canvas like a collaborator's. */
function AgentCursor() {
	const editor = useEditor()
	const live = useContext(AgentCursorContext)
	// Keep the last position while fading out once the agent goes idle.
	const lastRef = useRef(live)
	if (live) lastRef.current = live
	const point = live ?? lastRef.current
	const visible = !!live
	const screen = useValue(
		'agent cursor',
		() => {
			if (!point) return null
			editor.getCamera() // re-render on camera moves
			const p = editor.pageToViewport(point)
			// Flip the name tag to the left near the right edge so it isn't clipped.
			return { x: p.x, y: p.y, flip: p.x > editor.getViewportScreenBounds().w - 190 }
		},
		[editor, point]
	)
	if (!screen) return null
	return (
		<div
			className="pointer-events-none absolute left-0 top-0 z-[1000] transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
			style={{ transform: `translate(${screen.x}px, ${screen.y}px)`, opacity: visible ? 1 : 0 }}
			data-testid="agent-cursor"
			data-visible={visible}
			aria-hidden={!visible}
		>
			<svg width="20" height="20" viewBox="0 0 20 20" className="block drop-shadow-[0_2px_4px_rgba(0,0,0,0.25)]">
				<defs>
					<linearGradient id="agent-cursor-fill" x1="0" y1="0" x2="1" y2="1">
						<stop offset="0" stopColor="#5e5ce6" />
						<stop offset="1" stopColor="#bf5af2" />
					</linearGradient>
				</defs>
				<path d="M2 2 L18 8.5 L10.5 10.5 L8.5 18 Z" fill="url(#agent-cursor-fill)" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
			</svg>
			<div className={`-mt-0.5 flex ${screen.flip ? '-translate-x-full -ml-1' : 'ml-4'}`}>
				<div className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gradient-to-br from-[#5e5ce6] to-[#bf5af2] py-1 pl-1 pr-2.5 text-[12px] font-semibold text-white shadow-[0_4px_14px_rgba(94,92,230,0.35)]">
					<Orb state="speaking" size={16} />
					{AGENT_NAME}
				</div>
			</div>
		</div>
	)
}

// tldraw's style panel only for sketches/annotations: the Design tab edits 'ui' shapes.
function ContextualStylePanel(props: TLUiStylePanelProps) {
	const editor = useEditor()
	const show = useValue(
		'show style panel',
		() => {
			const selected = editor.getSelectedShapes()
			if (selected.length) return !selected.every(isUi)
			return !['select', 'hand', 'eraser', 'laser', 'zoom'].includes(editor.getCurrentToolId())
		},
		[editor]
	)
	return show ? <DefaultStylePanel {...props} /> : null
}

const components: TLComponents = { InFrontOfTheCanvas: AgentCursor, StylePanel: ContextualStylePanel, PageMenu: null,
	// The floating voice dock sits where tldraw puts these on narrow canvases; undo/delete/duplicate stay on keys, the context menu and the main menu.
	QuickActions: null,
	ActionsMenu: null,
}
// Zoom to fit / to selection keep the content above the floating voice dock.
const overrides: TLUiOverrides = {
	actions(editor, actions) {
		const fit = (bounds: Box | undefined, maxZoom: number) => {
			if (bounds) fitBounds(editor, bounds, { maxZoom })
		}
		actions['zoom-to-fit'] = { ...actions['zoom-to-fit'], onSelect: () => fit(editor.getCurrentPageBounds(), 1) }
		actions['zoom-to-selection'] = {
			...actions['zoom-to-selection'],
			onSelect: () => {
				if (editor.getSelectedShapeIds().length) fit(editor.getSelectionPageBounds() ?? undefined, Math.max(1, editor.getZoomLevel()))
			},
		}
		return actions
	},
}
// Bundle fonts/icons/translations instead of loading them from tldraw's CDN.
const assetUrls = getAssetUrlsByImport()
// Figma-like canvas: neutral gray pasteboard, #0D99FF selection.
const SELECTION = '#0D99FF'
const themes: Partial<TLThemes> = {
	default: {
		...DEFAULT_THEME,
		colors: {
			light: { ...DEFAULT_THEME.colors.light, background: '#ebebed', selectionStroke: SELECTION, selectionFill: 'rgba(13, 153, 255, 0.14)' },
			dark: { ...DEFAULT_THEME.colors.dark, background: '#161618', selectionStroke: SELECTION, selectionFill: 'rgba(13, 153, 255, 0.2)' },
		},
	},
}

type Tab = 'design' | 'agent'
const TAB_KEY = 'grok-design:tab'

export function Board({ roomId, me }: { roomId: string; me: Identity }) {
	const users = useMemo(() => {
		setUserPreferences({ id: me.userId, name: me.name, color: me.color })
		return {
			currentUser: atom('current user', UserRecordType.create({ id: createUserId(me.userId), name: me.name, color: me.color })),
		}
	}, [me])
	const store = useSync({
		uri: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync/${roomId}`,
		assets,
		users,
		themes,
		shapeUtils: syncShapeUtils,
	})
	const [editor, setEditor] = useState<Editor | null>(null)
	const agent = useAgent(roomId, me, editor)
	const voice = useVoice(editor, me, agent.state, agent.actions)
	// The shell's edits (Design panel, Layers, Insert) run through the agent's
	// executor as the local user, so layout logic lives in one place.
	const userExec = useMemo(() => (editor ? new CanvasExecutor(editor, { asUser: true }) : null), [editor])
	const [tab, setTabState] = useState<Tab>(() => {
		try {
			return localStorage.getItem(TAB_KEY) === 'agent' ? 'agent' : 'design'
		} catch {
			return 'design'
		}
	})
	const setTab = (t: Tab) => {
		setTabState(t)
		try {
			localStorage.setItem(TAB_KEY, t)
		} catch {}
	}
	const [codeFor, setCodeFor] = useState<TLShapeId | null>(null)
	const [layersOpen, setLayersOpen] = useState(false)
	const agentActive = agent.state.busy || agent.state.speaking || voice.live.active

	// On phones the layers drawer closes once something is picked.
	const selectionKey = useValue('selection key', () => editor?.getSelectedShapeIds().join(',') ?? '', [editor])
	useEffect(() => {
		if (selectionKey && window.matchMedia('(max-width: 767px)').matches) setLayersOpen(false)
	}, [selectionKey])

	return (
		<div className="flex h-full flex-col bg-[var(--bg)]">
			<TopBar
				roomId={roomId}
				me={me}
				participants={agent.state.participants}
				editor={editor}
				exec={userExec}
				onOpenCode={setCodeFor}
				onToggleLayers={() => setLayersOpen((o) => !o)}
				layersOpen={layersOpen}
			/>
			<div className="relative flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2 md:flex-row">
				{/* Layers: docked on desktop, a drawer over the canvas on phones */}
				<div
					className={`${layersOpen ? 'flex' : 'hidden'} absolute bottom-2 left-2 top-0 z-[700] w-[min(280px,calc(100%-16px))] md:static md:z-auto md:flex md:w-[232px] md:shrink-0 lg:w-[248px]`}
				>
					<LayersPanel editor={editor} exec={userExec} onClose={layersOpen ? () => setLayersOpen(false) : undefined} />
				</div>

				<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-[16px] shadow-[var(--shadow-panel)]" data-testid="canvas">
					<AgentCursorContext.Provider value={agent.state.agentCursor}>
						<Tldraw
							store={store}
							shapeUtils={customShapeUtils}
							assetUrls={assetUrls}
							themes={themes}
							licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
							components={components}
							overrides={overrides}
							onMount={(e) => {
								;(window as any).__editor = e
								// Used by e2e scripts to drive the canvas like the agent does.
								;(window as any).__executor = new CanvasExecutor(e)
								// Follow the OS light/dark appearance, like the rest of the app.
								e.user.updateUserPreferences({ colorScheme: 'system' })
								setEditor(e)
								return registerAuthorship(e, me)
							}}
						/>
					</AgentCursorContext.Provider>
					<EmptyCanvas editor={editor} exec={userExec} voice={voice} connected={agent.state.connected} busy={agent.state.busy} />
					<VoiceDock state={agent.state} voice={voice} onOpenAgent={() => setTab('agent')} onStop={agent.actions.stop} />
				</div>

				{/* Right: Design | Agent */}
				<aside className="flex h-[46%] w-full shrink-0 flex-col overflow-hidden rounded-[16px] bg-[var(--material-thick)] text-[var(--label)] shadow-[var(--shadow-panel)] md:h-full md:w-[300px] lg:w-[320px]">
					<div className="hairline-b flex h-10 shrink-0 items-center gap-1 px-2" role="tablist" aria-label="Panels">
						{(['design', 'agent'] as const).map((t) => (
							<button
								key={t}
								role="tab"
								aria-selected={tab === t}
								className={`tap relative flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[12px] transition ${
									tab === t ? 'bg-[var(--fill)] font-semibold text-[var(--label)]' : 'font-medium text-[var(--label-2)] hover:text-[var(--label)]'
								}`}
								onClick={() => setTab(t)}
							>
								{t === 'agent' && <Orb state={voice.orbState} size={14} />}
								{t === 'design' ? 'Design' : 'Agent'}
								{t === 'agent' && tab !== 'agent' && agentActive && <span className="h-1.5 w-1.5 rounded-full bg-[#0D99FF]" aria-label="active" />}
							</button>
						))}
						{tab === 'design' && (
							<button
								className="ml-auto flex h-7 min-w-0 max-w-[55%] items-center gap-1.5 truncate rounded-[7px] px-2 text-[11.5px] text-[var(--label-2)] transition hover:bg-[var(--fill-2)]"
								onClick={() => setTab('agent')}
								title={voice.status}
								data-testid="agent-status-strip"
							>
								<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${!agent.state.connected ? 'bg-[var(--label-3)]' : agentActive ? 'animate-pulse bg-[#0D99FF]' : 'bg-[var(--green)]'}`} />
								<span className="truncate">{voice.status}</span>
							</button>
						)}
					</div>
					<div className={`${tab === 'design' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`} role="tabpanel" aria-label="Design">
						<DesignPanel editor={editor} exec={userExec} onOpenCode={setCodeFor} />
					</div>
					<div className={`${tab === 'agent' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`} role="tabpanel" aria-label="Agent">
						<AgentPanel me={me} editor={editor} state={agent.state} actions={agent.actions} voice={voice} />
					</div>
				</aside>
			</div>
			{codeFor && editor && <CodeModal editor={editor} id={codeFor} onClose={() => setCodeFor(null)} />}
			<ConfirmDialog state={agent.state} />
		</div>
	)
}
