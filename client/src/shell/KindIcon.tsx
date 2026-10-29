import {
	KindAvatarIcon,
	KindBadgeIcon,
	KindButtonIcon,
	KindChartIcon,
	KindCheckboxIcon,
	KindDividerIcon,
	KindFrameIcon,
	KindIconIcon,
	KindImageIcon,
	KindInputIcon,
	KindOtherIcon,
	KindRectIcon,
	KindScreenIcon,
	KindTextIcon,
	KindToggleIcon,
} from '../components/icons.tsx'

const MAP = {
	screen: KindScreenIcon,
	frame: KindFrameIcon,
	text: KindTextIcon,
	button: KindButtonIcon,
	input: KindInputIcon,
	image: KindImageIcon,
	icon: KindIconIcon,
	avatar: KindAvatarIcon,
	toggle: KindToggleIcon,
	checkbox: KindCheckboxIcon,
	divider: KindDividerIcon,
	rect: KindRectIcon,
	badge: KindBadgeIcon,
	chart: KindChartIcon,
} as const

export const KIND_LABELS: Record<string, string> = {
	screen: 'Screen',
	frame: 'Frame',
	text: 'Text',
	button: 'Button',
	input: 'Input',
	image: 'Image',
	icon: 'Icon',
	avatar: 'Avatar',
	toggle: 'Toggle',
	checkbox: 'Checkbox',
	divider: 'Divider',
	rect: 'Rectangle',
	badge: 'Badge',
	chart: 'Chart',
}

export function KindIcon({ kind, className = 'h-3.5 w-3.5' }: { kind: string; className?: string }) {
	const C = MAP[kind as keyof typeof MAP] ?? KindOtherIcon
	return <C className={className} />
}
