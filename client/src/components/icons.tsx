// Small line icons in the spirit of SF Symbols (1.75px strokes, round caps).
type P = { className?: string }
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const MicIcon = ({ className }: P) => (
	<svg viewBox="0 0 24 24" className={className} {...base}>
		<rect x="9" y="3" width="6" height="11" rx="3" />
		<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
	</svg>
)
export const SendIcon = ({ className }: P) => (
	<svg viewBox="0 0 24 24" className={className} fill="currentColor">
		<path d="M12 4a1 1 0 0 1 .7.29l6 6a1 1 0 1 1-1.4 1.42L13 7.41V19a1 1 0 1 1-2 0V7.41l-4.3 4.3a1 1 0 0 1-1.4-1.42l6-6A1 1 0 0 1 12 4Z" />
	</svg>
)
export const SpeakerIcon = ({ className, muted }: P & { muted?: boolean }) => (
	<svg viewBox="0 0 24 24" className={className} {...base}>
		<path d="M4 9.5h3l4.5-4v13L7 14.5H4z" />
		{muted ? <path d="m16 9.5 5 5m0-5-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}
	</svg>
)
export const CheckIcon = ({ className }: P) => (
	<svg viewBox="0 0 24 24" className={className} {...base} strokeWidth={2.2}>
		<path d="m5 12.5 4.5 4.5L19 7.5" />
	</svg>
)
export const StopIcon = ({ className }: P) => (
	<svg viewBox="0 0 24 24" className={className} fill="currentColor">
		<rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />
	</svg>
)
export const LinkIcon = ({ className }: P) => (
	<svg viewBox="0 0 24 24" className={className} {...base}>
		<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
	</svg>
)
export const SparkleIcon = ({ className }: P) => (
	<svg viewBox="0 0 24 24" className={className} fill="currentColor">
		<path d="M12 2.5c.4 0 .7.3.8.7l.9 3.6a5 5 0 0 0 3.5 3.5l3.6.9a.8.8 0 0 1 0 1.6l-3.6.9a5 5 0 0 0-3.5 3.5l-.9 3.6a.8.8 0 0 1-1.6 0l-.9-3.6a5 5 0 0 0-3.5-3.5l-3.6-.9a.8.8 0 0 1 0-1.6l3.6-.9a5 5 0 0 0 3.5-3.5l.9-3.6c.1-.4.4-.7.8-.7Z" />
	</svg>
)
export const ChevronIcon = ({ className }: P) => (
	<svg viewBox="0 0 24 24" className={className} {...base}>
		<path d="m6 9 6 6 6-6" />
	</svg>
)
