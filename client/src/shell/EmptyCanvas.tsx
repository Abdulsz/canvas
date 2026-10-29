import { useValue, type Editor } from 'tldraw'
import { AGENT_NAME } from '../../../shared/protocol.ts'
import type { CanvasExecutor } from '../agent/executor.ts'
import type { Voice } from '../agent/useVoice.ts'
import { Orb } from '../components/AgentPanel.tsx'
import { BrowserIcon, GridIcon, KindScreenIcon, PlusIcon } from '../components/icons.tsx'
import { insertScreen } from './actions.ts'

const STARTERS: { prompt: string; hint: string; Icon: (p: { className?: string }) => React.ReactNode }[] = [
	{ prompt: 'Design a login screen', hint: 'Mobile · email + social', Icon: KindScreenIcon },
	{ prompt: 'Build a dashboard', hint: 'Desktop · stats + chart', Icon: GridIcon },
	{ prompt: 'Make a landing page', hint: 'Desktop · hero + features', Icon: BrowserIcon },
]

/**
 * First-run state of an empty file: what the tool does, three one-tap starts
 * that go to the agent, and blank artboards. Disappears once anything is drawn.
 */
export function EmptyCanvas({ editor, exec, voice, connected, busy }: { editor: Editor | null; exec: CanvasExecutor | null; voice: Voice; connected: boolean; busy: boolean }) {
	const empty = useValue('canvas empty', () => !!editor && editor.getCurrentPageShapeIds().size === 0, [editor])
	if (!empty || busy) return null
	return (
		// Fills the canvas above the voice dock (which ends 128px from the bottom); scrolls instead of clipping on short canvases.
		<div className="scroll-soft pointer-events-none absolute inset-x-0 bottom-[136px] top-0 z-[200] flex flex-col overflow-y-auto px-4 pt-12 md:pt-4" data-testid="empty-canvas">
			<div className="fade-up pointer-events-auto mx-auto my-auto flex w-full max-w-[580px] flex-col items-center text-center">
				<span className="hidden sm:block">
					<Orb state={voice.orbState} size={52} />
				</span>
				<h2 className="text-[20px] font-semibold leading-tight tracking-[-0.02em] text-[var(--label)] sm:mt-5 sm:text-[22px]">What are we designing today?</h2>
				<p className="mt-2 hidden max-w-[360px] text-[14px] leading-[1.5] text-[var(--label-2)] sm:block">
					Say it out loud or type it. {AGENT_NAME} builds the screens here while you talk, and you keep refining them together.
				</p>
				<p className="mt-1.5 text-[13px] leading-snug text-[var(--label-2)] sm:hidden">Say it or tap a start.</p>
				<div className="mt-4 grid w-full gap-2 sm:mt-6 sm:grid-cols-3">
					{STARTERS.map(({ prompt, hint, Icon }) => (
						<button
							key={prompt}
							disabled={!connected}
							onClick={() => voice.sendText(prompt)}
							className="tap group flex items-center gap-3 rounded-[14px] bg-[var(--card)] px-3 py-2 text-left shadow-[var(--shadow-control)] transition-[transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-[var(--shadow-panel)] active:translate-y-0 disabled:opacity-50 sm:flex-col sm:items-start sm:gap-2.5 sm:p-3"
						>
							<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_srgb,var(--agent-1)_12%,transparent)] text-[color-mix(in_srgb,var(--agent-1)_85%,var(--label))]">
								<Icon className="h-4 w-4" />
							</span>
							<span>
								<span className="block text-[13px] font-semibold leading-tight text-[var(--label)]">{prompt}</span>
								<span className="mt-0.5 block text-[12px] leading-tight text-[var(--label-2)]">{hint}</span>
							</span>
						</button>
					))}
				</div>
				{/* Phones start blank from Insert in the top bar. */}
				<div className="mt-5 hidden flex-wrap items-center justify-center gap-1.5 text-[12px] text-[var(--label-2)] sm:flex">
					<span className="mr-0.5">Or start blank:</span>
					{(['iphone', 'desktop'] as const).map((d) => (
						<button
							key={d}
							disabled={!editor || !exec}
							onClick={() => editor && exec && insertScreen(editor, exec, d)}
							className="tap inline-flex h-8 items-center gap-1 rounded-full bg-[var(--fill)] px-3 font-medium text-[var(--label)] transition-colors duration-150 hover:bg-[var(--fill-strong)] sm:h-7 sm:px-2.5"
						>
							<PlusIcon className="h-3 w-3" />
							{d === 'iphone' ? 'iPhone' : 'Desktop'}
						</button>
					))}
				</div>
			</div>
		</div>
	)
}
