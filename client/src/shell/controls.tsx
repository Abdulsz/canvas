import { useEffect, useRef, useState, type ReactNode } from 'react'
import { resolveColor, TOKENS, type ThemeSpec } from '../../../shared/design.ts'

// Compact Figma-style property controls used by the Design panel.

export const SELECTION_BLUE = '#0D99FF'

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
	return (
		<section className="hairline-b px-3.5 pb-3.5 pt-3">
			<div className="mb-2 flex h-5 items-center justify-between">
				<h3 className="text-[11px] font-semibold text-[var(--label)]">{title}</h3>
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
	'flex h-7 min-w-0 items-center gap-1.5 rounded-[6px] bg-[var(--fill-2)] px-2 text-[11.5px] text-[var(--label)] shadow-[inset_0_0_0_1px_transparent] transition focus-within:bg-[var(--card)] focus-within:shadow-[inset_0_0_0_1px_#0D99FF] hover:shadow-[inset_0_0_0_1px_var(--separator)]'

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
			<span className="w-3.5 shrink-0 text-center text-[11px] text-[var(--label-3)]">{label}</span>
			<input
				className="min-w-0 flex-1 bg-transparent tabular-nums outline-none focus-visible:outline-none"
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
			{suffix && <span className="shrink-0 text-[11px] text-[var(--label-3)]">{suffix}</span>}
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
				className="scroll-soft block min-h-[56px] w-full resize-y rounded-[6px] bg-[var(--fill-2)] px-2 py-1.5 text-[12px] leading-snug text-[var(--label)] outline-none transition focus:bg-[var(--card)] focus:shadow-[inset_0_0_0_1px_#0D99FF] focus-visible:outline-none"
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
				className="min-w-0 flex-1 bg-transparent outline-none focus-visible:outline-none"
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
			{label && <span className="shrink-0 text-[11px] text-[var(--label-3)]">{label}</span>}
			<select
				className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent pr-4 outline-none focus-visible:outline-none"
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
		<div className="grid h-7 rounded-[6px] bg-[var(--fill-2)] p-[2px]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={label}>
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
						className={`flex min-w-0 items-center justify-center truncate rounded-[4.5px] px-1 text-[11px] transition ${
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

/**
 * Color property: swatch (native picker), raw value ("$primary", "#hex",
 * "transparent") and design-token chips resolved against the screen theme.
 */
export function ColorField({ label, value, theme, onCommit, allowNone = true }: { label: string; value: string; theme: ThemeSpec; onCommit: (v: string) => void; allowNone?: boolean }) {
	const resolved = resolveColor(value, theme)
	const pickerRef = useRef<HTMLInputElement>(null)
	const lastPick = useRef(0)
	const pending = useRef<string | null>(null)
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
	return (
		<div className="space-y-1.5" data-testid={`color-${label.toLowerCase().replace(/\s+/g, '-')}`}>
			<div className="flex items-center gap-2">
				<span className="w-[62px] shrink-0 text-[11px] text-[var(--label-2)]">{label}</span>
				<div className={`${fieldBox} flex-1`}>
					<button type="button" className="shrink-0 rounded-[4px]" onClick={() => pickerRef.current?.click()} title="Pick a color" aria-label={`Pick ${label.toLowerCase()}`}>
						<Swatch color={resolved} size={15} />
					</button>
					<input ref={pickerRef} type="color" className="sr-only" tabIndex={-1} aria-label={`${label} picker`} value={toHex(resolved)} onChange={(e) => pick(e.target.value)} />
					<ColorText value={value} onCommit={onCommit} label={label} />
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-[2px] pl-[68px]">
				{TOKENS.map((t) => {
					const on = value === `$${t}`
					return (
						<button
							key={t}
							type="button"
							title={`$${t}`}
							aria-label={`${label}: ${t} token`}
							onClick={() => onCommit(`$${t}`)}
							className={`rounded-full p-[1.5px] transition ${on ? 'shadow-[0_0_0_1.5px_#0D99FF]' : 'hover:shadow-[0_0_0_1.5px_var(--separator)]'}`}
						>
							<span className="block h-[13px] w-[13px] rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.14)]" style={{ background: resolveColor(`$${t}`, theme) }} />
						</button>
					)
				})}
				{allowNone && (
					<button
						type="button"
						title="None"
						aria-label={`${label}: none`}
						onClick={() => onCommit('transparent')}
						className={`rounded-full p-[1.5px] transition ${value === 'transparent' ? 'shadow-[0_0_0_1.5px_#0D99FF]' : 'hover:shadow-[0_0_0_1.5px_var(--separator)]'}`}
					>
						<span className="relative block h-[13px] w-[13px] overflow-hidden rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.14)]">
							<span className="absolute left-1/2 top-[-2px] h-[18px] w-px -translate-x-1/2 rotate-45 bg-[var(--red)]" />
						</span>
					</button>
				)}
			</div>
		</div>
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
			className="min-w-0 flex-1 bg-transparent font-mono text-[11px] uppercase outline-none focus-visible:outline-none [&:not(:focus)]:normal-case"
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

/** Popover anchored under a trigger; closes on outside click / Escape. */
export function usePopover() {
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!open) return
		const onDown = (e: PointerEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
		}
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
		document.addEventListener('pointerdown', onDown, true)
		document.addEventListener('keydown', onKey)
		return () => {
			document.removeEventListener('pointerdown', onDown, true)
			document.removeEventListener('keydown', onKey)
		}
	}, [open])
	return { open, setOpen, ref }
}

export function MenuItem({ icon, label, hint, onClick, disabled }: { icon?: ReactNode; label: string; hint?: string; onClick: () => void; disabled?: boolean }) {
	return (
		<button
			type="button"
			role="menuitem"
			disabled={disabled}
			onClick={onClick}
			className="flex h-8 w-full items-center gap-2.5 rounded-[7px] px-2 text-left text-[13px] text-[var(--label)] transition hover:bg-[var(--fill)] disabled:opacity-40 disabled:hover:bg-transparent"
		>
			{icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--label-2)]">{icon}</span>}
			<span className="flex-1 truncate">{label}</span>
			{hint && <span className="shrink-0 text-[11px] tabular-nums text-[var(--label-3)]">{hint}</span>}
		</button>
	)
}

export const menuPanel = 'material pop absolute z-[600] mt-1.5 rounded-[12px] p-1.5 shadow-[var(--shadow-panel)]'
