import { useEffect, useMemo, useRef, useState } from 'react'
import { useValue, type Editor, type TLShapeId } from 'tldraw'
import { CheckIcon } from '../components/icons.tsx'
import { CloseIcon, CopyIcon, DownloadIcon } from '../components/icons.tsx'
import { isUi } from '../design/tree.ts'
import { htmlFor } from './actions.ts'

async function copyText(text: string) {
	try {
		await navigator.clipboard.writeText(text)
		return true
	} catch {
		// Fallback for non-secure contexts / denied clipboard permission.
		const ta = document.createElement('textarea')
		ta.value = text
		ta.style.position = 'fixed'
		ta.style.opacity = '0'
		document.body.appendChild(ta)
		ta.select()
		const ok = document.execCommand('copy')
		ta.remove()
		return ok
	}
}

/** Light syntax coloring for the generated HTML (tags, attributes, strings). */
function highlight(html: string) {
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	return esc(html).replace(/(&lt;\/?)([a-zA-Z0-9!-]+)([^&]*?)(\/?&gt;)/g, (_m, open, tag, attrs: string, close) => {
		const a = attrs.replace(/([a-zA-Z-:]+)(=)("[^"]*")/g, '<span class="tok-attr">$1</span>$2<span class="tok-str">$3</span>')
		return `<span class="tok-punct">${open}</span><span class="tok-tag">${tag}</span>${a}<span class="tok-punct">${close}</span>`
	})
}

/** "Copy code": copies the selected screen's HTML/CSS and shows it beside a live preview. */
export function CodeModal({ editor, id, onClose }: { editor: Editor; id: TLShapeId; onClose: () => void }) {
	const code = useValue('export html', () => htmlFor(editor, id), [editor, id])
	const [copied, setCopied] = useState<'auto' | 'manual' | null>(null)
	const [view, setView] = useState<'code' | 'preview'>('code')
	const rootW = useValue('export width', () => { const s = editor.getShape(id); return isUi(s) ? s.props.w : 390 }, [editor, id])
	const paneRef = useRef<HTMLDivElement>(null)
	const [paneW, setPaneW] = useState(440)
	useEffect(() => {
		const el = paneRef.current
		if (!el) return
		const ro = new ResizeObserver(() => setPaneW(el.clientWidth || 440))
		ro.observe(el)
		return () => ro.disconnect()
	}, [])
	const zoom = Math.min(1, Math.max(0.2, (paneW - 40) / rootW))

	useEffect(() => {
		if (code) void copyText(code.html).then((ok) => ok && setCopied('auto'))
		// Copy once on open.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [id])
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])
	const highlighted = useMemo(() => (code ? highlight(code.html) : ''), [code])
	if (!code) return null
	const lines = code.html.split('\n').length

	return (
		<div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/30 p-3 backdrop-blur-[3px] md:p-8" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="pop flex h-full max-h-[680px] w-full max-w-[1080px] flex-col overflow-hidden rounded-[18px] bg-[var(--card)] shadow-[var(--shadow-panel)]" role="dialog" aria-label="Code export" data-testid="code-modal">
				<header className="hairline-b flex h-12 shrink-0 items-center gap-3 px-4">
					<div className="min-w-0 flex-1">
						<div className="truncate text-[14px] font-semibold tracking-[-0.01em]">{code.name}</div>
						<div className="text-[11px] text-[var(--label-3)]">HTML + CSS · auto layout as flexbox, tokens as CSS variables · {lines} lines</div>
					</div>
					<div className="grid h-7 grid-cols-2 rounded-[7px] bg-[var(--fill-2)] p-[2px] md:hidden">
						{(['code', 'preview'] as const).map((v) => (
							<button key={v} className={`rounded-[5px] px-2.5 text-[12px] capitalize ${view === v ? 'bg-[var(--card)] font-semibold shadow-[var(--shadow-control)]' : 'text-[var(--label-2)]'}`} onClick={() => setView(v)}>
								{v}
							</button>
						))}
					</div>
					{copied === 'auto' && <span className="fade-up hidden items-center gap-1 text-[12px] text-[var(--green)] sm:flex"><CheckIcon className="h-3.5 w-3.5" /> Copied to clipboard</span>}
					<button
						className="flex h-8 items-center gap-1.5 rounded-full bg-[var(--fill)] px-3 text-[12px] font-medium transition-[color,background-color,box-shadow,transform] duration-150 hover:bg-[var(--fill-strong)]"
						onClick={() => {
							const blob = new Blob([code.html], { type: 'text/html' })
							const a = document.createElement('a')
							a.href = URL.createObjectURL(blob)
							a.download = `${code.name.replace(/[^\w.-]+/g, '-') || 'screen'}.html`
							a.click()
							setTimeout(() => URL.revokeObjectURL(a.href), 2000)
						}}
					>
						<DownloadIcon className="h-3.5 w-3.5" /> .html
					</button>
					<button
						className="flex h-8 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 text-[12px] font-semibold text-[var(--on-accent)] transition-[color,background-color,box-shadow,transform] duration-150 hover:bg-[var(--accent-hover)] active:scale-95"
						onClick={async () => {
							if (await copyText(code.html)) {
								setCopied('manual')
								setTimeout(() => setCopied(null), 1600)
							}
						}}
					>
						{copied === 'manual' ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
						{copied === 'manual' ? 'Copied' : 'Copy'}
					</button>
					<button className="tap flex h-8 w-8 items-center justify-center rounded-full text-[var(--label-2)] transition-colors duration-150 hover:bg-[var(--fill)]" onClick={onClose} aria-label="Close">
						<CloseIcon className="h-4 w-4" />
					</button>
				</header>
				<div className="flex min-h-0 flex-1">
					<div className={`code-view scroll-soft min-h-0 min-w-0 flex-1 overflow-auto bg-[#fbfbfc] dark:bg-[#141416] ${view === 'preview' ? 'hidden md:block' : ''}`}>
						<pre className="flex min-w-max p-4 font-mono text-[12px] leading-[1.6]">
							<code aria-hidden className="select-none pr-4 text-right text-[var(--label-3)]">
								{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
							</code>
							<code className="text-[var(--label)]" dangerouslySetInnerHTML={{ __html: highlighted }} />
						</pre>
					</div>
					<div ref={paneRef} className={`hairline-l min-h-0 w-full flex-col bg-[#e9eaee] md:flex md:w-[44%] ${view === 'code' ? 'hidden' : 'flex'}`}>
						<div className="flex h-8 shrink-0 items-center px-3 text-[11px] font-medium uppercase tracking-[0.06em] text-[#6b7280]">Preview</div>
						<iframe title="Preview" className="min-h-0 flex-1 border-0" srcDoc={code.html.replace('min-height: 100vh; display: grid; place-items: center;', `min-height: 100vh; display: grid; place-items: start center; padding: 8px 0 24px; zoom: ${zoom.toFixed(3)};`)} sandbox="" />
					</div>
				</div>
			</div>
		</div>
	)
}
