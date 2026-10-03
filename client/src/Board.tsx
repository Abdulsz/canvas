import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import { useSync } from '@tldraw/sync'
import { createContext, useContext, useMemo, useState } from 'react'
import {
	atom,
	createUserId,
	setUserPreferences,
	Tldraw,
	useEditor,
	useValue,
	UserRecordType,
	type Editor,
	type TLAssetStore,
	type TLComponents,
} from 'tldraw'
import { AGENT_NAME } from '../../shared/protocol.ts'
import { registerAuthorship } from './agent/authorship.ts'
import { useAgent } from './agent/useAgent.ts'
import { AgentPanel, Orb } from './components/AgentPanel.tsx'
import type { Identity } from './identity.ts'

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
	const point = useContext(AgentCursorContext)
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
			className="pointer-events-none absolute left-0 top-0 z-[1000] transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
			style={{ transform: `translate(${screen.x}px, ${screen.y}px)` }}
			data-testid="agent-cursor"
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

const components: TLComponents = { InFrontOfTheCanvas: AgentCursor }
// Bundle fonts/icons/translations instead of loading them from tldraw's CDN.
const assetUrls = getAssetUrlsByImport()

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
	})
	const [editor, setEditor] = useState<Editor | null>(null)
	const agent = useAgent(roomId, me, editor)

	return (
		<div className="flex h-full flex-col gap-2.5 bg-[var(--bg)] p-2.5 md:flex-row">
			<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-[22px] shadow-[var(--shadow-panel)]">
				<AgentCursorContext.Provider value={agent.state.agentCursor}>
					<Tldraw
						store={store}
						assetUrls={assetUrls}
						licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
						components={components}
						onMount={(e) => {
							;(window as any).__editor = e
							// Follow the OS light/dark appearance, like the rest of the app.
							e.user.updateUserPreferences({ colorScheme: 'system' })
							setEditor(e)
							return registerAuthorship(e, me)
						}}
					/>
				</AgentCursorContext.Provider>
			</div>
			<AgentPanel roomId={roomId} me={me} editor={editor} state={agent.state} actions={agent.actions} />
		</div>
	)
}
