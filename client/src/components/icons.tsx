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

// ---- Design-tool chrome icons (16px grid, 1.5px strokes)
const thin = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
const ico = (d: string) => ({ className }: P) => (
	<svg viewBox="0 0 16 16" className={className} {...thin}>
		<path d={d} />
	</svg>
)
export const KindScreenIcon = ico('M4.5 1.75h7a1 1 0 0 1 1 1v10.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1z M7 12h2')
export const KindFrameIcon = ico('M5 1.5v13 M11 1.5v13 M1.5 5h13 M1.5 11h13')
export const KindTextIcon = ico('M3 3.5h10 M8 3.5v9.5 M6 13h4')
export const KindButtonIcon = ico('M3 4.5h10a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 10V6A1.5 1.5 0 0 1 3 4.5z M5.5 8h5')
export const KindInputIcon = ico('M2.5 4.5h11a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z M4.5 6.5v3')
export const KindImageIcon = ico('M2.5 2.5h11a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z M1.5 11l3.5-3.5 3 3 2-2 4.5 4.5 M10.5 5.5h.01')
export const KindIconIcon = ico('M8 1.75l1.9 3.85 4.25.62-3.07 3 .72 4.23L8 11.45l-3.8 2 .72-4.23-3.07-3 4.25-.62z')
export const KindAvatarIcon = ico('M14.5 8a6.5 6.5 0 1 1-13 0a6.5 6.5 0 1 1 13 0z M10.25 6.5a2.25 2.25 0 1 1-4.5 0a2.25 2.25 0 1 1 4.5 0z M3.8 12.8c.9-1.5 2.4-2.3 4.2-2.3s3.3.8 4.2 2.3')
export const KindToggleIcon = ico('M5 4.5h6a3.5 3.5 0 0 1 0 7H5a3.5 3.5 0 0 1 0-7z M12.5 8a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0z')
export const KindCheckboxIcon = ico('M3 2.5h10a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z M5 8l2 2 4-4')
export const KindDividerIcon = ico('M1.5 8h13')
export const KindRectIcon = ico('M3 2.5h10a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z')
export const KindOtherIcon = ico('M2 13c2-6 4-9 6-9s2 4 4 4 2-2 2-2')
export const CaretIcon = ico('M6 4l4 4-4 4')
export const PlusIcon = ico('M8 3v10 M3 8h10')
export const SunIcon = ico('M10.5 8a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0z M8 1.5v1.25 M8 13.25v1.25 M1.5 8h1.25 M13.25 8h1.25 M3.4 3.4l.9.9 M11.7 11.7l.9.9 M3.4 12.6l.9-.9 M11.7 4.3l.9-.9')
export const MoonIcon = ico('M13.5 9.5A5.75 5.75 0 0 1 6.5 2.5a5.75 5.75 0 1 0 7 7z')
export const CodeIcon = ico('M5.5 4.5L2 8l3.5 3.5 M10.5 4.5L14 8l-3.5 3.5')
export const DownloadIcon = ico('M8 2v8.5 M4.5 7.5L8 11l3.5-3.5 M2.5 13.5h11')
export const LayersIcon = ico('M8 1.75l6.25 3.5L8 8.75l-6.25-3.5z M1.75 8L8 11.5 14.25 8 M1.75 10.75L8 14.25l6.25-3.5')
export const CloseIcon = ico('M4 4l8 8 M12 4l-8 8')
export const CopyIcon = ico('M5.5 5.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z M2.5 10.5v-7a1 1 0 0 1 1-1h7')
export const ArrowDownIcon = ico('M8 2.5v11 M4 9.5l4 4 4-4')
export const ArrowRightIcon = ico('M2.5 8h11 M9.5 4l4 4-4 4')
export const FileIcon = ico('M4 1.5h5l3.5 3.5v9a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z M9 1.5V5h3.5')
export const GridIcon = ico('M2.5 2.5h4.5v4.5H2.5z M9 2.5h4.5v4.5H9z M9 9h4.5v4.5H9z M2.5 9h4.5v4.5H2.5z')
export const BrowserIcon = ico('M2.5 2.5h11a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z M1.5 5.5h13')
