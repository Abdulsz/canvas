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
import { AGENT_COLOR, AGENT_NAME } from '../../shared/protocol.ts'
import { registerAuthorship } from './agent/authorship.ts'
import { useAgent } from './agent/useAgent.ts'
import { AgentPanel } from './components/AgentPanel.tsx'
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
			return editor.pageToViewport(point)
		},
		[editor, point]
	)
	if (!screen) return null
	return (
		<div
			className="pointer-events-none absolute left-0 top-0 z-[1000] transition-transform duration-300 ease-out"
			style={{ transform: `translate(${screen.x}px, ${screen.y}px)` }}
			data-testid="agent-cursor"
		>
			<svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow">
				<path d="M1 1 L17 7 L9 9 L7 17 Z" fill={AGENT_COLOR} stroke="white" strokeWidth="1.5" />
			</svg>
			<div className="ml-4 -mt-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ background: AGENT_COLOR }}>
				{AGENT_NAME}
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
		<div className="flex h-full flex-col bg-white md:flex-row">
			<div className="relative min-h-0 min-w-0 flex-1">
				<AgentCursorContext.Provider value={agent.state.agentCursor}>
					<Tldraw
						store={store}
						assetUrls={assetUrls}
						licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
						components={components}
						onMount={(e) => {
							;(window as any).__editor = e
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
