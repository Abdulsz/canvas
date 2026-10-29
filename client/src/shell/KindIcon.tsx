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
	RoleButtonsIcon,
	RoleCardIcon,
	RoleFooterIcon,
	RoleFormIcon,
	RoleHeaderIcon,
	RoleListIcon,
	RoleNavIcon,
	RoleRowIcon,
	RoleStackIcon,
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

export type LayerRole = 'header' | 'footer' | 'nav' | 'form' | 'list' | 'card' | 'buttons' | 'stack' | 'row' | 'frame'

const ROLE_ICONS = {
	header: RoleHeaderIcon,
	footer: RoleFooterIcon,
	nav: RoleNavIcon,
	form: RoleFormIcon,
	list: RoleListIcon,
	card: RoleCardIcon,
	buttons: RoleButtonsIcon,
	stack: RoleStackIcon,
	row: RoleRowIcon,
	frame: KindFrameIcon,
} as const

export const ROLE_LABELS: Record<LayerRole, string> = {
	header: 'Header',
	footer: 'Footer',
	nav: 'Navigation',
	form: 'Form',
	list: 'List',
	card: 'Card',
	buttons: 'Button group',
	stack: 'Vertical stack',
	row: 'Horizontal row',
	frame: 'Free frame',
}

/**
 * What a frame is, for its Layers icon: its name first (header, nav, form,
 * list, card, footer), then its auto-layout direction.
 */
export function layerRole(name: string, layout: 'vertical' | 'horizontal' | 'none' | undefined): LayerRole {
	const n = name.toLowerCase()
	if (/footer|bottom ?bar|home indicator/.test(n)) return 'footer'
	if (/header|top ?bar|app ?bar|toolbar|title ?bar/.test(n)) return 'header'
	if (/\bnav|sidebar|side ?bar|tab ?bar|\btabs\b|menu|breadcrumb/.test(n)) return 'nav'
	if (/form|fields?\b|inputs?\b|credentials|sign ?(in|up)|log ?in|search/.test(n)) return 'form'
	if (/list|rows?\b|items?\b|feed|table|activity|transactions|history|options|testimonials|features/.test(n)) return 'list'
	if (/card|tile|\bstats?\b|kpi|metric|panel|widget|summary|plan|pricing/.test(n)) return 'card'
	if (/buttons|actions|\bcta\b|social/.test(n)) return 'buttons'
	return layout === 'vertical' ? 'stack' : layout === 'horizontal' ? 'row' : 'frame'
}

export function RoleIcon({ role, className = 'h-3.5 w-3.5' }: { role: LayerRole; className?: string }) {
	const C = ROLE_ICONS[role]
	return <C className={className} />
}
