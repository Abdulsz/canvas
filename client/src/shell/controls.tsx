import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { resolveColor, TOKENS, type ThemeSpec } from '../../../shared/design.ts'

// Compact Figma-style property controls used by the Design panel.

export const SELECTION_BLUE = '#0D99FF'

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
	return (
		<section className="hairline-b px-3.5 pb-3.5 pt-3">
			<div className="mb-2 flex h-5 items-center justify-between">
				<h3 className="text-[12px] font-semibold text-[var(--label)]">{title}</h3>
				{action}
			</div>
			<div className="space-y-2">{children}</div>
		</section>
	)
}

export function Row({ children, cols = 2 }: { children: ReactNode; cols?: number }) {
	return <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{children}</div>
}

const fieldBox =
	'flex h-7 min-w-0 items-center gap-1.5 rounded-[6px] pointer-coarse:h-11 pointer-coarse:text-[14px] bg-[var(--fill-2)] px-2 text-[12px] text-[var(--label)] shadow-[inset_0_0_0_1px_transparent] transition-[color,background-color,box-shadow,transform] duration-150 focus-within:bg-[var(--card)] focus-within:shadow-[inset_0_0_0_1px_#0D99FF] hover:shadow-[inset_0_0_0_1px_var(--separator)]'

/** Number input that commits on Enter / blur, with arrow-key nudging (Shift = 10). */
export function NumberField({
	label,
	value,
	onCommit,
	min = 0,
	max,
	step = 1,
	suffix,
	title,
	disabled,
}: {
	label: ReactNode
	value: number
	onCommit: (v: number) => void
	min?: number
	max?: number
	step?: number
	suffix?: string
	title?: string
	disabled?: boolean
}) {
	const [draft, setDraft] = useState<string | null>(null)
	const shown = draft ?? String(Math.round(value * 100) / 100)
	const commit = (raw: string) => {
		setDraft(null)
		const n = Number(raw)
		if (!Number.isFinite(n) || raw.trim() === '') return
		const v = Math.max(min, max !== undefined ? Math.min(max, n) : n)
		if (v !== value) onCommit(v)
	}
	return (
		<label className={`${fieldBox} ${disabled ? 'opacity-50' : ''}`} title={title}>
			<span className="w-3.5 shrink-0 text-center text-[12px] text-[var(--label-3)]">{label}</span>
			<input
				className="h-full min-w-0 flex-1 bg-transparent tabular-nums outline-none focus-visible:outline-none"
				inputMode="decimal"
				value={shown}
				disabled={disabled}
				onFocus={(e) => e.target.select()}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={(e) => commit(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
					else if (e.key === 'Escape') {
						setDraft(null)
						;(e.target as HTMLInputElement).blur()
					} else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
						e.preventDefault()
						const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : step)
						const v = Math.max(min, Math.round((Number(shown) + d) * 100) / 100)
						setDraft(null)
						onCommit(max !== undefined ? Math.min(max, v) : v)
					}
				}}
			/>
			{suffix && <span className="shrink-0 text-[12px] text-[var(--label-3)]">{suffix}</span>}
		</label>
	)
}

export function TextField({ value, onCommit, placeholder, multiline, label }: { value: string; onCommit: (v: string) => void; placeholder?: string; multiline?: boolean; label?: string }) {
	const [draft, setDraft] = useState<string | null>(null)
	const shown = draft ?? value
	const commit = () => {
		if (draft !== null && draft !== value) onCommit(draft)
		setDraft(null)
	}
	if (multiline) {
		return (
			<textarea
				aria-label={label}
				className="scroll-soft block min-h-[56px] w-full resize-y rounded-[6px] bg-[var(--fill-2)] px-2 py-1.5 text-[12px] leading-snug text-[var(--label)] outline-none transition-[color,background-color,box-shadow,transform] duration-150 focus:bg-[var(--card)] focus:shadow-[inset_0_0_0_1px_#0D99FF] focus-visible:outline-none"
				value={shown}
				placeholder={placeholder}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur()
					if (e.key === 'Escape') setDraft(null)
				}}
			/>
		)
	}
	return (
		<label className={fieldBox}>
			<input
				aria-label={label}
				className="h-full min-w-0 flex-1 bg-transparent outline-none focus-visible:outline-none"
				value={shown}
				placeholder={placeholder}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
					if (e.key === 'Escape') {
						setDraft(null)
						;(e.target as HTMLInputElement).blur()
					}
				}}
			/>
		</label>
	)
}

export function Select<V extends string | number>({
	value,
	options,
	onChange,
	label,
	className = '',
}: {
	value: V
	options: { value: V; label: string }[]
	onChange: (v: V) => void
	label?: ReactNode
	className?: string
}) {
	return (
		<label className={`${fieldBox} relative pr-1 ${className}`}>
			{label && <span className="shrink-0 text-[12px] text-[var(--label-3)]">{label}</span>}
			<select
				className="h-full min-w-0 flex-1 cursor-pointer appearance-none bg-transparent pr-4 outline-none focus-visible:outline-none"
				value={String(value)}
				onChange={(e) => {
					const opt = options.find((o) => String(o.value) === e.target.value)
					if (opt) onChange(opt.value)
				}}
			>
				{options.map((o) => (
					<option key={String(o.value)} value={String(o.value)}>
						{o.label}
					</option>
				))}
			</select>
			<svg viewBox="0 0 16 16" className="pointer-events-none absolute right-1.5 h-3 w-3 text-[var(--label-3)]" fill="none" stroke="currentColor" strokeWidth="1.5">
				<path d="M4.5 6.5L8 10l3.5-3.5" />
			</svg>
		</label>
	)
}

export function Segmented<V extends string>({
	value,
	options,
	onChange,
	label,
}: {
	value: V | undefined
	options: { value: V; label: ReactNode; title?: string }[]
	onChange: (v: V) => void
	label?: string
}) {
	return (
		<div className="grid h-7 rounded-[6px] bg-[var(--fill-2)] p-[2px] pointer-coarse:h-12" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={label}>
			{options.map((o) => {
				const on = o.value === value
				return (
					<button
						key={o.value}
						type="button"
						role="radio"
						aria-checked={on}
						title={o.title}
						onClick={() => onChange(o.value)}
						className={`flex min-w-0 items-center justify-center truncate rounded-[4.5px] px-1 text-[12px] transition-[color,background-color,box-shadow,transform] duration-150 ${
							on ? 'bg-[var(--card)] font-semibold text-[var(--label)] shadow-[var(--shadow-control)]' : 'text-[var(--label-2)] hover:text-[var(--label)]'
						}`}
					>
						{o.label}
					</button>
				)
			})}
		</div>
	)
}

const CHECKER = 'repeating-conic-gradient(#d4d4d8 0% 25%, #ffffff 0% 50%) 50% / 8px 8px'

export function Swatch({ color, size = 16, className = '' }: { color: string; size?: number; className?: string }) {
	const transparent = color === 'transparent'
	return (
		<span
			className={`relative inline-block shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)] ${className}`}
			style={{ width: size, height: size, background: transparent ? CHECKER : color }}
		>
			{transparent && <span className="absolute left-1/2 top-[-2px] h-[calc(100%+4px)] w-px -translate-x-1/2 rotate-45 bg-[var(--red)]" />}
		</span>
	)
}

const toHex = (c: string) => {
	if (/^#[0-9a-f]{6}$/i.test(c)) return c
	if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + [...c.slice(1)].map((x) => x + x).join('')
	return '#000000'
}

const TOKEN_NAMES: Record<string, string> = {
	bg: 'Background',
	surface: 'Surface',
	surfaceAlt: 'Surface alt',
	primary: 'Primary',
	primarySoft: 'Primary soft',
	onPrimary: 'On primary',
	text: 'Text',
	muted: 'Muted',
	border: 'Border',
	success: 'Success',
	successSoft: 'Success soft',
	warning: 'Warning',
	warningSoft: 'Warning soft',
	danger: 'Danger',
	dangerSoft: 'Danger soft',
}
const tokenName = (value: string) => (value === 'transparent' ? 'None' : value.startsWith('$') ? (TOKEN_NAMES[value.slice(1)] ?? value) : value.toUpperCase())

/**
 * Color property: one compact row (swatch + raw value: "$primary", "#hex",
 * "None"). The swatch opens a token popover (named swatches resolved against
 * the screen theme, None, and a custom color picker), so Fill / Text / Stroke
 * don't each repeat a 16-swatch grid.
 */
export function ColorField({ label, value, theme, onCommit, allowNone = true }: { label: string; value: string; theme: ThemeSpec; onCommit: (v: string) => void; allowNone?: boolean }) {
	const resolved = resolveColor(value, theme)
	const pickerRef = useRef<HTMLInputElement>(null)
	const lastPick = useRef(0)
	const pending = useRef<string | null>(null)
	const pop = usePopover()
	// Throttle live picker drags to ~12 edits/s.
	useEffect(() => () => void (pending.current = null), [])
	const pick = (hex: string) => {
		pending.current = hex
		const now = Date.now()
		if (now - lastPick.current > 80) {
			lastPick.current = now
			onCommit(hex)
			pending.current = null
		} else
			setTimeout(() => {
				if (pending.current) {
					onCommit(pending.current)
					pending.current = null
				}
			}, 90)
	}
	const items: { value: string; name: string; color: string }[] = [
		...TOKENS.map((t) => ({ value: `$${t}`, name: TOKEN_NAMES[t] ?? t, color: resolveColor(`$${t}`, theme) })),
		...(allowNone ? [{ value: 'transparent', name: 'None', color: 'transparent' }] : []),
	]
	return (
		<div ref={pop.ref} className="flex items-center gap-2" data-testid={`color-${label.toLowerCase().replace(/\s+/g, '-')}`}>
			<span className="w-[62px] shrink-0 text-[12px] text-[var(--label-2)]">{label}</span>
			<div className={`${fieldBox} flex-1`}>
				<button
					type="button"
					className={`tap -ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] transition-[background-color,box-shadow] duration-150 hover:bg-[var(--fill)] pointer-coarse:-ml-2 pointer-coarse:h-11 pointer-coarse:w-11 ${pop.open ? 'bg-[var(--fill)]' : ''}`}
					onClick={() => pop.toggle()}
					title={`${label}: ${tokenName(value)} (choose a token or color)`}
					aria-label={`${label}: ${tokenName(value)}. Choose color`}
					aria-haspopup="menu"
					aria-expanded={pop.open}
				>
					<Swatch color={resolved} size={15} />
				</button>
				<input ref={pickerRef} type="color" className="sr-only" tabIndex={-1} aria-label={`${label} picker`} value={toHex(resolved)} onChange={(e) => pick(e.target.value)} />
				<ColorText value={value} onCommit={onCommit} label={label} />
			</div>
			{pop.open && (
				<FloatingMenu anchor={pop.ref} panelRef={pop.panelRef} label={`${label} color`} testId="token-popover" cols={2}>
					<div className="px-1.5 pb-1.5 pt-0.5 text-[12px] font-semibold text-[var(--label)]">{label} · theme tokens</div>
					<div className="grid grid-cols-2 gap-0.5">
						{items.map((it) => {
							const on = value === it.value
							return (
								<button
									key={it.value}
									type="button"
									role="menuitemradio"
									aria-checked={on}
									title={it.value === 'transparent' ? 'None (transparent)' : `${it.name} · ${it.value} · ${it.color.toUpperCase()}`}
									onClick={() => {
										onCommit(it.value)
										pop.close(true)
									}}
									className={`flex h-8 min-w-0 items-center gap-2 rounded-[7px] px-1.5 text-left text-[12px] text-[var(--label)] transition-[background-color,box-shadow] duration-150 hover:bg-[var(--fill)] active:bg-[var(--press)] pointer-coarse:h-11 pointer-coarse:text-[13px] ${on ? 'bg-[var(--fill-2)] font-semibold' : ''}`}
								>
									<span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ${on ? 'shadow-[0_0_0_2px_var(--menu),0_0_0_4px_#0D99FF]' : ''}`}>
										{it.value === 'transparent' ? (
											<span className="relative block h-[18px] w-[18px] overflow-hidden rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.16)]">
												<span className="absolute left-1/2 top-[-2px] h-[22px] w-px -translate-x-1/2 rotate-45 bg-[var(--red)]" />
											</span>
										) : (
											<span className="block h-[18px] w-[18px] rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.16)]" style={{ background: it.color }} />
										)}
									</span>
									<span className="truncate">{it.name}</span>
								</button>
							)
						})}
					</div>
					<div className="mx-1 my-1.5 h-px bg-[var(--separator)]" />
					<MenuItem
						icon={<span className="block h-[14px] w-[14px] rounded-full" style={{ background: 'conic-gradient(#f43f5e, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef, #f43f5e)' }} />}
						label="Custom color…"
						hint={value.startsWith('#') ? value.toUpperCase() : undefined}
						onClick={() => {
							pickerRef.current?.click()
							pop.close(true)
						}}
					/>
				</FloatingMenu>
			)}
		</div>
	)
}

/**
 * Menu rendered in a portal (scroll containers and backdrop-filtered panels
 * would clip or re-anchor it), 6px from its anchor and inside the viewport.
 */
function FloatingMenu({ anchor, panelRef, label, testId, cols, children }: { anchor: RefObject<HTMLDivElement | null>; panelRef: RefObject<HTMLDivElement | null>; label: string; testId: string; cols?: number; children: ReactNode }) {
	const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null)
	useLayoutEffect(() => {
		const a = anchor.current?.getBoundingClientRect()
		const p = panelRef.current
		if (!a || !p) return
		const w = p.offsetWidth
		const h = p.scrollHeight
		const left = Math.max(8, Math.min(innerWidth - w - 8, a.right - w))
		const below = innerHeight - a.bottom - 6 - 8
		const above = a.top - 6 - 8
		const down = h <= below || below >= above
		setPos({ left, top: down ? a.bottom + 6 : Math.max(8, a.top - 6 - Math.min(h, above)), maxH: Math.max(160, down ? below : above) })
	}, [anchor, panelRef])
	return createPortal(
		<div
			ref={panelRef}
			role="menu"
			aria-label={label}
			data-testid={testId}
			data-cols={cols}
			className="menu-surface pop scroll-soft fixed z-[900] w-[260px] overflow-y-auto rounded-[12px] p-1.5"
			style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxH } : { left: -9999, top: 0 }}
		>
			{children}
		</div>,
		document.body
	)
}

function ColorText({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }) {
	const [draft, setDraft] = useState<string | null>(null)
	const commit = () => {
		const v = draft?.trim()
		setDraft(null)
		if (!v || v === value) return
		const tok = v.replace(/^\$/, '')
		if ((TOKENS as readonly string[]).includes(tok)) onCommit(`$${tok}`)
		else if (/^#?[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(v)) onCommit(v.startsWith('#') ? v : `#${v}`)
		else if (v === 'none' || v === 'transparent') onCommit('transparent')
	}
	return (
		<input
			aria-label={`${label} value`}
			className="h-full min-w-0 flex-1 bg-transparent font-mono text-[12px] uppercase outline-none focus-visible:outline-none [&:not(:focus)]:normal-case"
			value={draft ?? (value === 'transparent' ? 'None' : value.startsWith('$') ? value : value.toUpperCase())}
			onChange={(e) => setDraft(e.target.value)}
			onFocus={(e) => e.target.select()}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
				if (e.key === 'Escape') {
					setDraft(null)
					;(e.target as HTMLInputElement).blur()
				}
			}}
		/>
	)
}

const MENU_ITEMS = '[role=menuitem]:not(:disabled), [role=menuitemradio]:not(:disabled)'

/**
 * Popover anchored to a trigger (the [aria-haspopup] inside `ref`). Opening
 * moves focus into the menu (the checked item, else the first); arrows move
 * between items (Up/Down by the menu's data-cols); Escape or an outside press
 * closes it, and Escape returns focus to the trigger.
 */
export function usePopover() {
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const trigger = () => ref.current?.querySelector<HTMLElement>('[aria-haspopup]') ?? null
	const menu = () => panelRef.current ?? ref.current?.querySelector<HTMLElement>('[role=menu]') ?? null
	const close = (refocus = false) => {
		setOpen(false)
		if (refocus) requestAnimationFrame(() => trigger()?.focus({ preventScroll: true }))
	}
	useEffect(() => {
		if (!open) return
		const raf = requestAnimationFrame(() => {
			const m = menu()
			const first = m?.querySelector<HTMLElement>('[aria-checked=true]') ?? m?.querySelector<HTMLElement>(MENU_ITEMS)
			first?.focus({ preventScroll: true })
		})
		const inside = (t: EventTarget | null) => !!t && (!!ref.current?.contains(t as Node) || !!panelRef.current?.contains(t as Node))
		const onDown = (e: PointerEvent) => {
			if (!inside(e.target)) setOpen(false)
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault()
				e.stopPropagation()
				close(true)
				return
			}
			const m = menu()
			if (!m || !m.contains(document.activeElement)) return
			const items = [...m.querySelectorAll<HTMLElement>(MENU_ITEMS)]
			const i = items.indexOf(document.activeElement as HTMLElement)
			const cols = Number(m.dataset.cols) || 1
			const step = ({ ArrowDown: cols, ArrowUp: -cols, ArrowRight: 1, ArrowLeft: -1 } as Record<string, number>)[e.key]
			let next = -1
			if (step) next = Math.max(0, Math.min(items.length - 1, i + step))
			else if (e.key === 'Home') next = 0
			else if (e.key === 'End') next = items.length - 1
			else if (e.key === 'Tab') setOpen(false)
			if (next >= 0) {
				e.preventDefault()
				items[next]?.focus()
			}
		}
		// Scrolling the page under a fixed (portalled) menu would strand it: close.
		const onScroll = (e: Event) => {
			if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
		}
		document.addEventListener('pointerdown', onDown, true)
		document.addEventListener('keydown', onKey, true)
		document.addEventListener('scroll', onScroll, true)
		return () => {
			cancelAnimationFrame(raf)
			document.removeEventListener('pointerdown', onDown, true)
			document.removeEventListener('keydown', onKey, true)
			document.removeEventListener('scroll', onScroll, true)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open])
	return { open, setOpen, toggle: () => setOpen((o) => !o), close, ref, panelRef }
}

export function MenuItem({ icon, label, hint, onClick, disabled }: { icon?: ReactNode; label: string; hint?: string; onClick: () => void; disabled?: boolean }) {
	return (
		<button
			type="button"
			role="menuitem"
			disabled={disabled}
			onClick={onClick}
			className="flex h-9 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] pointer-coarse:h-11 text-[var(--label)] transition-[color,background-color,box-shadow,transform] duration-150 hover:bg-[var(--fill)] active:bg-[var(--press)] disabled:opacity-40 disabled:hover:bg-transparent"
		>
			{icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--label-2)]">{icon}</span>}
			<span className="flex-1 truncate">{label}</span>
			{hint && <span className="shrink-0 text-[12px] tabular-nums text-[var(--label-2)]">{hint}</span>}
		</button>
	)
}

export const menuPanel = 'menu-surface pop absolute z-[600] mt-1.5 rounded-[14px] p-2'
