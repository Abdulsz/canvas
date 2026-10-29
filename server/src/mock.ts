import type { ToolDef } from '../../shared/tools.ts'
import { StreamAssembler, type ChatMessage, type Completion, type LLMProvider, type StreamHandlers, type ToolCall } from './llm.ts'

// A scripted stand-in for Grok, used when no XAI_API_KEY is set (local
// development, demos, and end-to-end tests). It exercises the same tool
// pipeline as the real model: building screens, editing them from spoken
// requests, reading the canvas, and critiquing.

let n = 0
const call = (name: string, args: object): ToolCall => ({
	id: `mock_${++n}`,
	type: 'function',
	function: { name, arguments: JSON.stringify(args) },
})

function textOf(m: ChatMessage): string {
	if (typeof m.content === 'string') return m.content
	if (Array.isArray(m.content)) return m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
	return ''
}

// ------------------------------------------------------------------ spec helpers

type Spec = Record<string, any>
const txt = (id: string, text: string, extra: Spec = {}): Spec => ({ id, type: 'text', text, ...extra })
const muted = (id: string, text: string, extra: Spec = {}): Spec => txt(id, text, { textColor: '$muted', fontSize: 14, ...extra })
const frame = (id: string, children: Spec[], extra: Spec = {}): Spec => ({ id, type: 'frame', children, ...extra })
const row = (id: string, children: Spec[], extra: Spec = {}): Spec => frame(id, children, { layout: 'horizontal', alignItems: 'center', ...extra })
const secondaryBtn = (id: string, text: string, extra: Spec = {}): Spec => ({ id, type: 'button', text, fill: '$surface', textColor: '$text', stroke: '$border', strokeWidth: 1, ...extra })

const COLORS: Record<string, string> = {
	green: '#16a34a',
	red: '#dc2626',
	blue: '#2563eb',
	purple: '#7c3aed',
	violet: '#7c3aed',
	orange: '#f97316',
	yellow: '#eab308',
	pink: '#ec4899',
	teal: '#0d9488',
	black: '#111827',
	grey: '#6b7280',
	gray: '#6b7280',
}

// ------------------------------------------------------------------ screens
//
// Drafts follow one system: 8pt spacing (8/16/24/32/48), Inter type scale
// 13/14/16/20/28-32/56-64, labelled form fields, $surface cards on the
// off-white $bg, brand tints ($primarySoft) for icon tiles, chips and avatars.

/** A field with a visible label above the input (no placeholder-only labels). */
const field = (id: string, label: string, input: Spec): Spec =>
	frame(`${id}_field`, [txt(`${id}_label`, label, { fontSize: 14, fontWeight: 500 }), { id, type: 'input', ...input }], { gap: 8, name: `${label} field` })

/** A square icon tile: an icon node with a brand-tinted fill (the glyph is centered by the renderer). */
const iconTile = (id: string, icon: string, size = 40, extra: Spec = {}): Spec => ({
	id,
	type: 'icon',
	icon,
	width: size,
	height: size,
	fill: '$primarySoft',
	textColor: extra.fill === '$primary' ? '$onPrimary' : '$primary',
	radius: Math.round(size / 3.5),
	...extra,
})

/** A pill badge (eyebrows, deltas, statuses). */
const chip = (id: string, text: string, extra: Spec = {}, icon?: string): Spec => ({ id, type: 'badge', text, ...(icon ? { icon } : {}), ...extra })

const card = (id: string, children: Spec[], extra: Spec = {}): Spec => frame(id, children, { width: 'fill', gap: 16, padding: 24, fill: '$surface', stroke: '$border', strokeWidth: 1, radius: 16, ...extra })

function loginScreen(): Spec {
	return {
		id: 'login',
		name: 'Login',
		device: 'iphone',
		layout: 'vertical',
		gap: 24,
		padding: [88, 24, 40, 24],
		alignItems: 'stretch',
		children: [
			frame(
				'login_content',
				[
					frame('login_header', [
						iconTile('login_logo', 'sparkle', 56, { fill: '$primary', radius: 16 }),
						frame('login_heading', [txt('login_title', 'Welcome back', { fontSize: 30, fontWeight: 700 }), muted('login_subtitle', 'Log in to pick up where you left off.', { fontSize: 16 })], { gap: 8 }),
					], { gap: 24 }),
					frame('login_form', [
						field('login_email', 'Email', { icon: 'mail', text: 'you@example.com' }),
						field('login_password', 'Password', { icon: 'lock', text: 'Enter your password', trailingIcon: 'eye' }),
						row('login_options', [
							{ id: 'login_remember', type: 'checkbox', text: 'Remember me', fontSize: 14, checked: true },
							txt('login_forgot', 'Forgot password?', { textColor: '$primary', fontSize: 14, fontWeight: 600 }),
						], { width: 'fill', justify: 'space-between' }),
					], { gap: 16 }),
					{ id: 'login_primary_btn', type: 'button', text: 'Log in', width: 'fill', height: 52 },
				],
				{ width: 'fill', height: 'fill', gap: 32, alignItems: 'stretch' }
			),
			row('login_footer', [muted('login_footer_text', "Don't have an account?"), txt('login_signup_link', 'Sign up', { textColor: '$primary', fontSize: 14, fontWeight: 600 })], {
				width: 'fill',
				justify: 'center',
				gap: 4,
			}),
		],
	}
}

const loginSocial = (): Spec[] => [
	row('login_or', [{ id: 'login_or_l', type: 'divider', name: 'Divider', width: 'fill' }, muted('login_or_text', 'or continue with'), { id: 'login_or_r', type: 'divider', name: 'Divider', width: 'fill' }], { width: 'fill', gap: 16 }),
	row('login_social', [secondaryBtn('login_google_btn', 'Google', { width: 'fill', icon: 'google' }), secondaryBtn('login_apple_btn', 'Apple', { width: 'fill', icon: 'apple' })], { width: 'fill', gap: 12 }),
]

function signupScreen(): Spec {
	return {
		id: 'signup',
		name: 'Sign up',
		device: 'iphone',
		layout: 'vertical',
		gap: 24,
		padding: [88, 24, 40, 24],
		alignItems: 'stretch',
		children: [
			frame(
				'signup_content',
				[
					frame('signup_header', [
						txt('signup_title', 'Create your account', { fontSize: 30, fontWeight: 700 }),
						muted('signup_subtitle', 'It only takes a minute. No credit card needed.', { fontSize: 16 }),
					], { gap: 8 }),
					frame('signup_form', [
						field('signup_name', 'Full name', { icon: 'user', text: 'Jane Cooper' }),
						field('signup_email', 'Email', { icon: 'mail', text: 'you@example.com' }),
						field('signup_password', 'Password', { icon: 'lock', text: 'At least 8 characters', trailingIcon: 'eye' }),
						{ id: 'signup_terms', type: 'checkbox', text: 'I agree to the Terms and Privacy Policy', fontSize: 14, checked: true },
					], { gap: 16 }),
					{ id: 'signup_primary_btn', type: 'button', text: 'Create account', width: 'fill', height: 52 },
				],
				{ width: 'fill', height: 'fill', gap: 32, alignItems: 'stretch' }
			),
			row('signup_footer', [muted('signup_footer_text', 'Already have an account?'), txt('signup_login_link', 'Log in', { textColor: '$primary', fontSize: 14, fontWeight: 600 })], {
				width: 'fill',
				justify: 'center',
				gap: 4,
			}),
		],
	}
}

/** The four stat cards, written once as a template (like the prompt teaches the model). */
const dashStats = (): Spec => ({
	id: 'dash_stats',
	type: 'frame',
	layout: 'horizontal',
	gap: 16,
	alignItems: 'stretch',
	template: card('dash_stat', [
		row('dash_stat_top', [muted('dash_stat_label', '{label}', { fontWeight: 500 }), iconTile('dash_stat_icon', '{icon}', 36)], { width: 'fill', justify: 'space-between' }),
		txt('dash_stat_value', '{value}', { fontSize: 28, fontWeight: 700 }),
		row('dash_stat_trend', [chip('dash_stat_delta', '{delta}', { fill: '{bg}', textColor: '{fg}', icon: '{arrow}' }), muted('dash_stat_period', 'vs last month', { fontSize: 13 })], { gap: 8 }),
	], { gap: 12, padding: 20 }),
	items: [
		{ label: 'Revenue', icon: 'wallet', value: '$48,230', delta: '12.4%', bg: '$successSoft', fg: '$success', arrow: 'arrow-up-right' },
		{ label: 'Orders', icon: 'cart', value: '1,284', delta: '5.1%', bg: '$successSoft', fg: '$success', arrow: 'arrow-up-right' },
		{ label: 'New customers', icon: 'users', value: '312', delta: '8.2%', bg: '$successSoft', fg: '$success', arrow: 'arrow-up-right' },
		{ label: 'Refunds', icon: 'receipt', value: '37', delta: '2.3%', bg: '$dangerSoft', fg: '$danger', arrow: 'arrow-down-right' },
	],
})

function dashboardScreen(): Spec {
	return {
		id: 'dashboard',
		name: 'Dashboard',
		device: 'desktop',
		layout: 'horizontal',
		gap: 0,
		padding: 0,
		alignItems: 'stretch',
		children: [
			frame('dash_sidebar', [
				row('dash_brand', [iconTile('dash_logo', 'sparkle', 32, { fill: '$primary', radius: 10 }), txt('dash_brand_name', 'Lumen', { fontSize: 18, fontWeight: 700 })], { gap: 12, padding: [0, 8, 24, 8] }),
				{
					id: 'dash_nav',
					type: 'frame',
					gap: 4,
					template: row('dash_nav_item', [
						{ id: 'dash_nav_icon', type: 'icon', icon: '{icon}', width: 20, height: 20, textColor: '{color}' },
						txt('dash_nav_label', '{label}', { fontSize: 15, fontWeight: 500, textColor: '{color}' }),
					], { width: 'fill', gap: 12, padding: [10, 12, 10, 12], radius: 10, fill: '{bg}' }),
					items: [
						{ icon: 'home', label: 'Overview', bg: '$primarySoft', color: '$primary' },
						{ icon: 'cart', label: 'Orders', color: '$text' },
						{ icon: 'package', label: 'Products', color: '$text' },
						{ icon: 'users', label: 'Customers', color: '$text' },
						{ icon: 'chart', label: 'Analytics', color: '$text' },
						{ icon: 'settings', label: 'Settings', color: '$text' },
					],
				},
				frame('dash_sidebar_spacer', [], { height: 'fill' }),
				row('dash_me', [
					{ id: 'dash_avatar', type: 'avatar', text: 'Ava Kim' },
					frame('dash_me_info', [txt('dash_me_name', 'Ava Kim', { fontSize: 14, fontWeight: 600 }), muted('dash_me_role', 'Store owner', { fontSize: 13 })], { gap: 2, width: 'fill' }),
					{ id: 'dash_me_more', type: 'icon', icon: 'more', width: 20, height: 20, textColor: '$muted' },
				], { width: 'fill', gap: 12, padding: 8 }),
			], { width: 248, height: 'fill', gap: 4, padding: [28, 16, 24, 16], fill: '$surface', stroke: '$border', strokeWidth: 1 }),
			frame('dash_main', [
				row('dash_header', [
					frame('dash_heading', [txt('dash_title', 'Overview', { fontSize: 28, fontWeight: 700 }), muted('dash_subtitle', "Here's how your store is doing this month.", { fontSize: 15 })], { gap: 4, width: 'fill' }),
					row('dash_actions', [
						{ id: 'dash_search', type: 'input', icon: 'search', text: 'Search orders', width: 260, height: 40, fontSize: 14 },
						secondaryBtn('dash_bell', '', { icon: 'bell', width: 40, height: 40, padding: 0 }),
						{ id: 'dash_primary_btn', type: 'button', text: 'New order', icon: 'plus', height: 40, fontSize: 14, padding: [0, 16, 0, 14] },
					], { width: 'hug', gap: 12 }),
				], { width: 'fill', gap: 24 }),
				frame(
					'dash_content',
					[
						dashStats(),
						row('dash_mid', [card('dash_chart', [
							row('dash_chart_head', [
								frame('dash_chart_titles', [txt('dash_chart_title', 'Revenue', { fontSize: 16, fontWeight: 600 }), muted('dash_chart_sub', 'Weekly, last 12 weeks', { fontSize: 13 })], { gap: 2, width: 'fill' }),
								chip('dash_chart_range', 'Last 12 weeks', { fill: '$surfaceAlt', textColor: '$text' }),
							], { width: 'fill' }),
							{ id: 'dash_chart_plot', type: 'chart', chart: 'bar', height: 'fill', data: [8.2, 9.6, 8.9, 11.4, 10.6, 12.8, 12.1, 14.2, 11.8, 13.5, 15.9, 14.6], labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12'], prefix: '$', suffix: 'k' },
						], { gap: 16, padding: [20, 24, 20, 24] }), dashTopProducts()], { width: 'fill', gap: 24, alignItems: 'stretch' }),
					],
					{ width: 'fill', gap: 24, alignItems: 'stretch' }
				),
			], { width: 'fill', height: 'fill', gap: 28, padding: [32, 40, 32, 40] }),
		],
	}
}

/** Beside the chart: best sellers with a share bar each, so the chart row has two panels. */
const dashTopProducts = (): Spec =>
	card('dash_top', [
		row('dash_top_head', [txt('dash_top_title', 'Top products', { fontSize: 16, fontWeight: 600 }), muted('dash_top_period', 'This month', { fontSize: 13 })], { width: 'fill', justify: 'space-between' }),
		{
			id: 'dash_top_rows',
			type: 'frame',
			gap: 16,
			template: frame('dash_top_item', [
				row('dash_top_line', [
					iconTile('dash_top_icon', '{icon}', 36, { radius: 10 }),
					frame('dash_top_info', [txt('dash_top_name', '{name}', { fontSize: 14, fontWeight: 600 }), muted('dash_top_sold', '{sold}', { fontSize: 13 })], { gap: 2, width: 'fill' }),
					txt('dash_top_rev', '{rev}', { fontSize: 14, fontWeight: 600 }),
				], { width: 'fill', gap: 12 }),
				row('dash_top_bar', [{ id: 'dash_top_bar_on', type: 'rect', width: '{on}' as any, height: 6, radius: 3, fill: '$primary' }, { id: 'dash_top_bar_off', type: 'rect', width: 'fill', height: 6, radius: 3, fill: '$surfaceAlt' }], { width: 'fill', gap: 0, padding: [0, 0, 0, 48] }),
			], { gap: 8 }),
			items: [
				{ icon: 'package', name: 'Linen tote', sold: '412 sold', rev: '$12,360', on: 180 },
				{ icon: 'star', name: 'Ceramic mug set', sold: '298 sold', rev: '$8,940', on: 132 },
				{ icon: 'heart', name: 'Candle trio', sold: '241 sold', rev: '$6,025', on: 96 },
				{ icon: 'cart', name: 'Gift card', sold: '188 sold', rev: '$4,700', on: 70 },
			],
		},
	], { width: 340, gap: 20, padding: [20, 24, 20, 24] })

const dashActivity = (): Spec =>
	card('dash_activity', [
		row('dash_activity_head', [txt('dash_activity_title', 'Recent orders', { fontSize: 16, fontWeight: 600 }), txt('dash_activity_all', 'View all', { fontSize: 14, fontWeight: 600, textColor: '$primary' })], { width: 'fill', justify: 'space-between' }),
		row('dash_table_head', [
			muted('dash_th_customer', 'CUSTOMER', { fontSize: 12, fontWeight: 600, width: 'fill' }),
			muted('dash_th_status', 'STATUS', { fontSize: 12, fontWeight: 600, width: 120 }),
			muted('dash_th_amount', 'AMOUNT', { fontSize: 12, fontWeight: 600, width: 96, align: 'right' }),
		], { width: 'fill', gap: 16, padding: [8, 0, 8, 0] }),
		{
			id: 'dash_activity_rows',
			type: 'frame',
			gap: 0,
			dividers: true,
			template: row('dash_row', [
				row('dash_row_who', [
					{ id: 'dash_row_avatar', type: 'avatar', text: '{who}', width: 36, height: 36 },
					frame('dash_row_info', [txt('dash_row_name', '{who}', { fontSize: 15, fontWeight: 600 }), muted('dash_row_what', '{what}', { fontSize: 13 })], { gap: 2, width: 'fill' }),
				], { width: 'fill', gap: 12 }),
				frame('dash_row_status_cell', [chip('dash_row_status', '{status}', { fill: '{bg}', textColor: '{fg}' })], { width: 120 }),
				txt('dash_row_amount', '{amount}', { fontSize: 15, fontWeight: 600, width: 96, align: 'right' }),
			], { width: 'fill', gap: 16, padding: [8, 0, 8, 0] }),
			items: [
				{ who: 'Maya Chen', what: 'Order #1042 · 3 items', amount: '$128.00', status: 'Paid', bg: '$successSoft', fg: '$success' },
				{ who: 'Leo Park', what: 'Order #1041 · 1 item', amount: '$54.90', status: 'Pending', bg: '$warningSoft', fg: '$warning' },
				{ who: 'Sam Ortiz', what: 'Order #1040 · 2 items', amount: '$87.50', status: 'Paid', bg: '$successSoft', fg: '$success' },
				{ who: 'Ines Duarte', what: 'Order #1039 · 4 items', amount: '$212.30', status: 'Refunded', bg: '$dangerSoft', fg: '$danger' },
				{ who: 'Noah Reid', what: 'Order #1038 · 2 items', amount: '$64.00', status: 'Paid', bg: '$successSoft', fg: '$success' },
			],
		},
	], { gap: 4, padding: [20, 24, 8, 24] })

function landingScreen(): Spec {
	return {
		id: 'landing',
		name: 'Landing page',
		device: 'desktop',
		height: 2600,
		layout: 'vertical',
		gap: 0,
		padding: 0,
		alignItems: 'stretch',
		children: [
			row('landing_nav', [
				row('landing_brand', [iconTile('landing_logo', 'sparkle', 32, { fill: '$primary', radius: 10 }), txt('landing_brand_name', 'Acme', { fontSize: 20, fontWeight: 700 })], { width: 'hug', gap: 12 }),
				{ id: 'landing_links', type: 'frame', layout: 'horizontal', width: 'hug', gap: 32, template: txt('landing_link', '{t}', { fontSize: 15, fontWeight: 500, textColor: '$muted' }), items: [{ t: 'Product' }, { t: 'Pricing' }, { t: 'Customers' }, { t: 'Docs' }] },
				row('landing_nav_actions', [txt('landing_login', 'Log in', { fontSize: 15, fontWeight: 600 }), { id: 'landing_nav_cta', type: 'button', text: 'Get started', height: 40, fontSize: 14, padding: [0, 18, 0, 18] }], { width: 'hug', gap: 24 }),
			], { width: 'fill', justify: 'space-between', padding: [20, 80, 20, 80] }),
			frame(
				'landing_hero',
				[
					chip('landing_eyebrow', 'Introducing Acme 2.0', {}, 'sparkle'),
					txt('landing_headline', 'Design faster, together', { fontSize: 64, fontWeight: 700, align: 'center' }),
					muted('landing_sub', 'Describe what you want and watch it appear. Share it with your team in one click.', { fontSize: 20, align: 'center', width: 640 }),
					row('landing_cta', [{ id: 'landing_primary_btn', type: 'button', text: 'Start for free', height: 52, padding: [0, 28, 0, 28] }, secondaryBtn('landing_secondary_btn', 'Watch demo', { icon: 'play', height: 52, padding: [0, 24, 0, 24] })], { width: 'hug', gap: 12 }),
					muted('landing_note', 'Free for teams up to 3 · No credit card required', { fontSize: 13 }),
					landingProductShot(),
				],
				{ width: 'fill', gap: 24, alignItems: 'center', padding: [48, 80, 0, 80] }
			),
			frame('landing_logos', [
				muted('landing_logos_title', 'Trusted by product teams at', { fontSize: 14, fontWeight: 500 }),
				{
					id: 'landing_logos_row',
					type: 'frame',
					layout: 'horizontal',
					width: 'hug',
					gap: 56,
					template: row('landing_logo', [{ id: 'landing_logo_mark', type: 'icon', icon: '{icon}', width: 28, height: 28, radius: 8, fill: '$surfaceAlt', textColor: '$muted' }, txt('landing_logo_name', '{n}', { fontSize: 19, fontWeight: 700, textColor: '$muted' })], { width: 'hug', gap: 10 }),
					items: [
						{ n: 'Northwind', icon: 'target' },
						{ n: 'Lumen', icon: 'sun' },
						{ n: 'Pioneer', icon: 'zap' },
						{ n: 'Halcyon', icon: 'globe' },
						{ n: 'Vertex', icon: 'layers' },
					],
				},
			], { width: 'fill', gap: 20, alignItems: 'center', padding: [72, 80, 0, 80] }),
		],
	}
}

/** The hero's product shot: a real miniature of the app UI, not a placeholder image. */
function landingProductShot(): Spec {
	return frame('landing_shot', [
		frame('landing_shot_side', [
			row('landing_shot_brand', [iconTile('landing_shot_logo', 'sparkle', 28, { fill: '$primary', radius: 8 }), txt('landing_shot_name', 'Acme', { fontSize: 15, fontWeight: 700 })], { gap: 10, padding: [0, 4, 12, 4] }),
			{
				id: 'landing_shot_nav',
				type: 'frame',
				gap: 4,
				template: row('landing_shot_nav_item', [{ id: 'landing_shot_nav_icon', type: 'icon', icon: '{icon}', width: 18, height: 18, textColor: '{color}' }, txt('landing_shot_nav_label', '{label}', { fontSize: 14, fontWeight: 500, textColor: '{color}' })], { gap: 10, padding: [8, 10, 8, 10], radius: 8, fill: '{bg}' }),
				items: [
					{ icon: 'grid', label: 'Screens', bg: '$primarySoft', color: '$primary' },
					{ icon: 'layers', label: 'Components', color: '$muted' },
					{ icon: 'users', label: 'Team', color: '$muted' },
					{ icon: 'chart', label: 'Insights', color: '$muted' },
				],
			},
		], { width: 200, height: 'fill', gap: 8, padding: [20, 12, 20, 12], fill: '$bg', radius: 14 }),
		frame('landing_shot_main', [
			{
				id: 'landing_shot_stats',
				type: 'frame',
				layout: 'horizontal',
				gap: 16,
				template: card('landing_shot_stat', [muted('landing_shot_stat_label', '{label}', { fontSize: 13 }), row('landing_shot_stat_row', [txt('landing_shot_stat_value', '{value}', { fontSize: 24, fontWeight: 700 }), chip('landing_shot_stat_delta', '{delta}', { fill: '$successSoft', textColor: '$success', icon: 'arrow-up-right' })], { gap: 10 })], { gap: 8, padding: 18 }),
				items: [
					{ label: 'Screens shipped', value: '128', delta: '24%' },
					{ label: 'Review time', value: '1.4d', delta: '38%' },
					{ label: 'Team members', value: '42', delta: '12%' },
				],
			},
			card('landing_shot_chart', [
				row('landing_shot_chart_head', [txt('landing_shot_chart_title', 'Designs shipped per week', { fontSize: 15, fontWeight: 600, width: 'fill' }), chip('landing_shot_chart_range', 'Q3', { fill: '$surfaceAlt', textColor: '$text' })], { width: 'fill' }),
				{ id: 'landing_shot_plot', type: 'chart', chart: 'line', height: 'fill', data: [12, 18, 15, 24, 22, 31, 29, 38, 42], labels: ['Jul', '', 'Aug', '', 'Sep', '', 'Oct', '', 'Nov'] },
			], { height: 'fill', gap: 8, padding: [18, 20, 14, 20] }),
		], { width: 'fill', height: 'fill', gap: 16 }),
	], {
		layout: 'horizontal',
		width: 1120,
		height: 560,
		gap: 16,
		padding: 16,
		fill: '$surface',
		stroke: '$border',
		strokeWidth: 1,
		radius: 24,
		shadow: 'lg',
	})
}

const landingFeatures = (): Spec =>
	frame('landing_features', [
		frame('landing_features_head', [
			txt('landing_features_title', 'Everything your team needs', { fontSize: 40, fontWeight: 700, align: 'center' }),
			muted('landing_features_sub', 'From first sketch to shipped code, without the handoff headaches.', { fontSize: 18, align: 'center' }),
		], { width: 'hug', gap: 12, alignItems: 'center' }),
		{
			id: 'landing_features_row',
			type: 'frame',
			layout: 'horizontal',
			gap: 24,
			alignItems: 'stretch',
			template: card('landing_feature', [
				iconTile('landing_feature_icon', '{icon}', 48),
				frame('landing_feature_text', [txt('landing_feature_title', '{title}', { fontSize: 20, fontWeight: 600 }), muted('landing_feature_body', '{body}', { fontSize: 16, width: 'fill' })], { gap: 8 }),
			], { gap: 20, padding: 32, radius: 20 }),
			items: [
				{ icon: 'zap', title: 'Lightning fast', body: 'Go from idea to a clickable draft in seconds, just by describing it.' },
				{ icon: 'users', title: 'Built for teams', body: 'Invite anyone and design together in real time, with comments.' },
				{ icon: 'shield', title: 'Ship with confidence', body: 'Export clean code and hand it straight to your engineers.' },
			],
		},
	], { width: 'fill', gap: 48, alignItems: 'center', padding: [96, 80, 72, 80] })

/** Social proof between the features and the closing CTA. */
const landingTestimonial = (): Spec =>
	frame('landing_quote_wrap', [
		card('landing_quote', [
			{ id: 'landing_quote_stars', type: 'frame', layout: 'horizontal', width: 'hug', gap: 4, template: { id: 'landing_star', type: 'icon', icon: 'star', width: 20, height: 20, textColor: '$warning' }, items: [{}, {}, {}, {}, {}] },
			txt('landing_quote_text', '"We went from a napkin sketch to a reviewed flow in one meeting. Acme is the first tool our PMs and engineers both open every day."', { fontSize: 24, fontWeight: 500, align: 'center', width: 'fill' }),
			row('landing_quote_who', [
				{ id: 'landing_quote_avatar', type: 'avatar', text: 'Priya Nair', width: 44, height: 44 },
				frame('landing_quote_info', [txt('landing_quote_name', 'Priya Nair', { fontSize: 16, fontWeight: 600 }), muted('landing_quote_role', 'Head of Design, Northwind', { fontSize: 14 })], { gap: 2, width: 'hug' }),
			], { width: 'hug', gap: 12 }),
		], { width: 880, gap: 24, padding: [40, 56, 40, 56], radius: 24, alignItems: 'center' }),
	], { width: 'fill', alignItems: 'center', padding: [0, 80, 72, 80] })

const landingFooter = (): Spec =>
	row('landing_footer', [
		row('landing_footer_brand', [iconTile('landing_footer_logo', 'sparkle', 28, { fill: '$primary', radius: 8 }), muted('landing_footer_copy', '© 2026 Acme Inc.', { fontSize: 13 })], { width: 'hug', gap: 12 }),
		{ id: 'landing_footer_links', type: 'frame', layout: 'horizontal', width: 'hug', gap: 28, template: muted('landing_footer_link', '{t}', { fontSize: 13, fontWeight: 500 }), items: [{ t: 'Privacy' }, { t: 'Terms' }, { t: 'Status' }, { t: 'Contact' }] },
	], { width: 'fill', justify: 'space-between', padding: [28, 80, 40, 80] })

const landingCta = (): Spec =>
	frame('landing_cta_band', [
		frame('landing_cta_text', [
			txt('landing_cta_title', 'Your next screen is one sentence away', { fontSize: 36, fontWeight: 700, textColor: '$onPrimary' }),
			txt('landing_cta_sub', 'Join 4,000 teams designing out loud with Acme.', { fontSize: 18, textColor: '$onPrimary', opacity: 0.85 }),
		], { gap: 8, width: 'fill' }),
		{ id: 'landing_cta_btn', type: 'button', text: 'Start for free', height: 52, fill: '$surface', textColor: '$text', padding: [0, 28, 0, 28] },
	], { layout: 'horizontal', alignItems: 'center', gap: 32, padding: [48, 56, 48, 56], fill: '$primary', radius: 24 })

function onboardingScreen(i: number, title: string, desc: string, last = false): Spec {
	const id = `onb${i}`
	return {
		id,
		name: `Onboarding ${i}`,
		device: 'iphone',
		layout: 'vertical',
		gap: 24,
		padding: [64, 24, 40, 24],
		alignItems: 'stretch',
		children: [
			frame(
				`${id}_content`,
				[
					{ id: `${id}_img`, type: 'image', name: 'Illustration', text: i === 1 ? 'Friends planning a trip, abstract' : 'Maps and tickets, abstract', width: 'fill', height: 360, radius: 32 },
					frame(`${id}_text`, [
						chip(`${id}_eyebrow`, `Step ${i} of 3`),
						txt(`${id}_title`, title, { fontSize: 30, fontWeight: 700, align: 'center', width: 'fill' }),
						muted(`${id}_desc`, desc, { fontSize: 16, align: 'center', width: 'fill' }),
					], { gap: 12, alignItems: 'center' }),
					{
						id: `${id}_dots`,
						type: 'frame',
						layout: 'horizontal',
						width: 'hug',
						gap: 8,
						template: { id: `${id}_dot`, type: 'rect', width: '{w}', height: 8, radius: 4, fill: '{fill}' },
						items: [1, 2, 3].map((d) => (d === i ? { w: 24, fill: '$primary' } : { w: 8, fill: '$border' })),
					},
				],
				{ width: 'fill', height: 'fill', gap: 28, alignItems: 'center', justify: 'center' }
			),
			frame(`${id}_footer`, [
				{ id: `${id}_next`, type: 'button', text: last ? 'Get started' : 'Continue', width: 'fill', height: 52 },
				{ id: `${id}_skip`, type: 'button', text: 'Skip', width: 'fill', fill: 'transparent', textColor: '$muted' },
			], { width: 'fill', gap: 8, alignItems: 'stretch' }),
		],
	}
}

function settingsScreen(): Spec {
	type Row = { icon: string; label: string; toggle?: boolean; checked?: boolean; value?: string }
	const group = (id: string, title: string, rows: Row[]) =>
		frame(`${id}_group`, [
			muted(`${id}_heading`, title.toUpperCase(), { fontSize: 12, fontWeight: 600 }),
			frame(
				id,
				rows.flatMap((r, i) => {
					const key = `${id}_${i + 1}`
					const out: Spec[] = i ? [{ id: `${key}_div`, type: 'divider', width: 'fill' }] : []
					out.push(
						row(key, [
							iconTile(`${key}_icon`, r.icon, 32, { radius: 9 }),
							txt(`${key}_label`, r.label, { width: 'fill', fontWeight: 500 }),
							...(r.value ? [muted(`${key}_value`, r.value)] : []),
							r.toggle ? { id: `${key}_toggle`, type: 'toggle', checked: !!r.checked } : { id: `${key}_arrow`, type: 'icon', icon: 'chevron-right', width: 20, height: 20, textColor: '$muted' },
						], { width: 'fill', gap: 12, padding: [12, 16, 12, 16] })
					)
					return out
				}),
				{ width: 'fill', gap: 0, fill: '$surface', stroke: '$border', strokeWidth: 1, radius: 16 }
			),
		], { gap: 8 })
	return {
		id: 'settings',
		name: 'Settings',
		device: 'iphone',
		layout: 'vertical',
		gap: 20,
		padding: [60, 20, 24, 20],
		alignItems: 'stretch',
		tabs: [
			{ icon: 'home', label: 'Home' },
			{ icon: 'search', label: 'Explore' },
			{ icon: 'bell', label: 'Activity' },
			{ icon: 'settings', label: 'Settings' },
		],
		activeTab: 3,
		children: [
			txt('settings_title', 'Settings', { fontSize: 30, fontWeight: 700 }),
			card('settings_profile', [
				{ id: 'settings_avatar', type: 'avatar', text: 'Jane Cooper', width: 48, height: 48 },
				frame('settings_profile_info', [txt('settings_profile_name', 'Jane Cooper', { fontWeight: 600 }), muted('settings_profile_email', 'jane@example.com')], { gap: 2, width: 'fill' }),
				{ id: 'settings_profile_arrow', type: 'icon', icon: 'chevron-right', width: 20, height: 20, textColor: '$muted' },
			], { layout: 'horizontal', alignItems: 'center', gap: 16, padding: 16 }),
			frame(
				'settings_content',
				[
					group('settings_account', 'Account', [
						{ icon: 'user', label: 'Personal info' },
						{ icon: 'lock', label: 'Password' },
						{ icon: 'credit-card', label: 'Subscription', value: 'Pro' },
					]),
					group('settings_prefs', 'Preferences', [
						{ icon: 'bell', label: 'Notifications', toggle: true, checked: true },
						{ icon: 'moon', label: 'Dark mode', toggle: true },
						{ icon: 'globe', label: 'Language', value: 'English' },
					]),
					secondaryBtn('settings_logout_btn', 'Log out', { width: 'fill', textColor: '$danger', icon: 'logout' }),
				],
				{ width: 'fill', gap: 20, alignItems: 'stretch' }
			),
		],
	}
}

function genericScreen(request: string): { spec: Spec; name: string } {
	const stop = new Set(['a', 'an', 'the', 'me', 'my', 'please', 'design', 'create', 'build', 'make', 'show', 'draw', 'sketch', 'screen', 'page', 'app', 'for', 'of', 'to', 'i', 'want', 'need', 'can', 'you', 'new', 'some', 'with', 'and', 'add', 'a', 'something', 'like'])
	const words = request.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !stop.has(w)).slice(0, 3)
	const name = words.length ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : 'New screen'
	const slug = words.join('_') || 'new'
	const id = `screen_${slug}`
	const item = (k: number, icon: string, title: string, body: string): Spec =>
		row(`${id}_item_${k}`, [
			iconTile(`${id}_item_${k}_icon`, icon, 48, { radius: 14 }),
			frame(`${id}_item_${k}_text`, [txt(`${id}_item_${k}_title`, title, { fontWeight: 600 }), muted(`${id}_item_${k}_body`, body)], { gap: 2, width: 'fill' }),
			{ id: `${id}_item_${k}_arrow`, type: 'icon', icon: 'chevron-right', width: 20, height: 20, textColor: '$muted' },
		], { width: 'fill', gap: 16, padding: 16, fill: '$surface', stroke: '$border', strokeWidth: 1, radius: 16 })
	return {
		name,
		spec: {
			id,
			name,
			device: 'iphone',
			layout: 'vertical',
			gap: 16,
			padding: [64, 24, 32, 24],
			alignItems: 'stretch',
			children: [
				frame(`${id}_content`, [
					frame(`${id}_header`, [
						txt(`${id}_title`, name, { fontSize: 30, fontWeight: 700 }),
						muted(`${id}_subtitle`, 'A first draft based on your idea. Tell me what to change.', { fontSize: 16 }),
					], { gap: 8 }),
					{ id: `${id}_input`, type: 'input', icon: 'search', text: 'Search' },
					{ id: `${id}_image`, type: 'image', name: 'Hero image', width: 'fill', height: 180, radius: 20 },
					frame(`${id}_list`, [item(1, 'star', 'Item one', 'Short description'), item(2, 'bookmark', 'Item two', 'Short description')], { gap: 12 }),
					{ id: `${id}_primary_btn`, type: 'button', text: 'Continue', width: 'fill', height: 52 },
				], { width: 'fill', height: 'fill', gap: 24, alignItems: 'stretch' }),
			],
		},
	}
}

// ------------------------------------------------------------------ canvas state parsing

type TreeNode = { id: string; type: string; name: string; text: string; children: TreeNode[]; raw: any; user: boolean }

function parseNode(raw: any, inheritedUser = false): TreeNode {
	const user = inheritedUser || raw?.author?.kind === 'user' || raw?.meta?.author?.kind === 'user'
	const kids: any[] = Array.isArray(raw?.children) ? raw.children : []
	return {
		id: String(raw?.id ?? '').replace(/^shape:/, ''),
		type: String(raw?.type ?? raw?.kind ?? ''),
		name: String(raw?.name ?? ''),
		text: String(raw?.text ?? raw?.label ?? ''),
		children: kids.filter((k) => k && typeof k === 'object').map((k) => parseNode(k, user)),
		raw,
		user,
	}
}

function parseScreens(tool: ChatMessage | undefined): TreeNode[] {
	if (!tool) return []
	let parsed: any
	try {
		parsed = JSON.parse(textOf(tool))
	} catch {
		return []
	}
	const body = parsed?.data ?? parsed
	const list: any[] = [...(Array.isArray(body?.screens) ? body.screens : []), ...(Array.isArray(body?.shapes) ? body.shapes : [])]
	return list.map((s) => parseNode(s)).filter((s) => s.type === 'screen' || s.children.length)
}

function walk(node: TreeNode, fn: (n: TreeNode) => void) {
	fn(node)
	node.children.forEach((c) => walk(c, fn))
}

function descendants(node: TreeNode): TreeNode[] {
	const out: TreeNode[] = []
	walk(node, (n) => n !== node && out.push(n))
	return out
}

const primaryButton = (screen: TreeNode) => {
	const buttons = descendants(screen).filter((n) => n.type === 'button')
	return buttons.find((b) => /primary/.test(b.id)) ?? buttons[0]
}

const mainContent = (screen: TreeNode) =>
	descendants(screen).find((n) => n.type === 'frame' && (/content$/.test(n.id) || /content/i.test(n.name))) ?? screen.children.find((c) => c.type === 'frame') ?? screen

const titleNode = (screen: TreeNode) => {
	const texts = descendants(screen).filter((n) => n.type === 'text')
	return texts.find((t) => /title|headline|heading/.test(t.id)) ?? texts[0]
}

/** Design nodes collaborators changed, newest first, from the trigger's "Recent collaborator edits". */
function recentEdits(trigger: string): { id: string; by: string }[] {
	const json = trigger.match(/\nRecent collaborator edits: (\{.*\})/)?.[1]
	if (!json) return []
	let byUser: Record<string, { op: string; shape: { id: string; type: string; kind?: string; label?: string } }[]>
	try {
		byUser = JSON.parse(json)
	} catch {
		return []
	}
	const out: { id: string; by: string; rank: number }[] = []
	for (const [by, entries] of Object.entries(byUser)) {
		entries.forEach((e, i) => {
			if (e.op === 'deleted' || e.shape?.type !== 'ui') return
			// Text-bearing nodes first: re-layout also touches their containers.
			const rank = (['text', 'button', 'input', 'checkbox'].includes(e.shape.kind ?? '') ? 0 : 1000) + i
			out.push({ id: String(e.shape.id).replace(/^shape:/, ''), by, rank })
		})
	}
	return out.sort((a, b) => a.rank - b.rank)
}

// ------------------------------------------------------------------ edit parsing

type Edit =
	| { kind: 'theme'; mode: 'light' | 'dark' }
	| { kind: 'color'; color: string; colorName: string; target: 'button' }
	| { kind: 'rename'; target: string; text: string }
	| { kind: 'delete'; what: string }
	| { kind: 'add_component'; component: string; label?: string }
	| { kind: 'add_screen'; what: string; connect: boolean }
	| { kind: 'build'; screen: string }
	| { kind: 'generic' }

const SCREEN_KINDS: [string, RegExp][] = [
	['login', /\b(log ?in|sign ?in)\b/],
	['signup', /\b(sign ?up|register|registration|create account)\b/],
	['dashboard', /\b(dashboard|analytics|admin|stats)\b/],
	['landing', /\b(landing|home ?page|hero|website|marketing)\b/],
	['onboarding', /\b(onboarding|walkthrough|welcome flow|intro flow)\b/],
	['settings', /\b(settings|preferences|profile)\b/],
]
const screenKind = (u: string) => SCREEN_KINDS.find(([, re]) => re.test(u))?.[0]

function parseEdit(text: string): Edit {
	const u = text.toLowerCase()
	const building = /\b(design|create|build|sketch)\b/.test(u)
	if (!building && /\b(dark|night)\s*(mode|theme)\b|\bdark(en)?\b.*\b(mode|theme|it)\b|\bswitch to dark\b/.test(u)) return { kind: 'theme', mode: 'dark' }
	if (!building && /\b(light|day)\s*(mode|theme)\b|\bswitch to light\b/.test(u)) return { kind: 'theme', mode: 'light' }

	if (/\badd\b.*\bscreen\b/.test(u) || /\banother (screen|page)\b/.test(u)) {
		return { kind: 'add_screen', what: screenKind(u) ?? 'generic', connect: true }
	}

	const comp = u.match(/\badd\s+(?:a|an|another|one|the)?\s*(?:new\s+)?(?:\w+\s+)?(button|input|field|text ?field|image|photo|picture|toggle|switch|checkbox|text|label|heading)\b/)
	if (comp) {
		const c = comp[1].replace(/\s/g, '')
		const component = { field: 'input', textfield: 'input', photo: 'image', picture: 'image', switch: 'toggle', label: 'text', heading: 'text' }[c] ?? c
		const label = text.match(/(?:says?|called|labell?ed|named|saying|that reads|reading)\s+["'“]?(.+?)["'”]?\s*$/i)?.[1]
		return { kind: 'add_component', component, label }
	}

	const del = u.match(/\b(?:delete|remove|get rid of|drop)\s+(?:the\s+)?(.+?)\s*$/)
	if (del) return { kind: 'delete', what: del[1].replace(/[.!?]+$/, '') }

	const ren = text.match(/\b(?:change|rename|set|update|make)\s+(?:the\s+)?(title|heading|headline|subtitle|button(?: text| label)?)\s+(?:text\s+)?(?:to|say|read)\s+["'“]?(.+?)["'”]?\s*[.!?]*$/i)
	if (ren) return { kind: 'rename', target: ren[1].toLowerCase(), text: ren[2] }

	const colorWord = Object.keys(COLORS).find((c) => new RegExp(`\\b${c}\\b`).test(u))
	const hex = u.match(/#[0-9a-f]{6}\b/)?.[0]
	if ((colorWord || hex) && /\b(button|cta|primary)\b/.test(u)) {
		return { kind: 'color', color: hex ?? COLORS[colorWord!], colorName: colorWord ?? 'new', target: 'button' }
	}

	const sk = screenKind(u)
	if (sk) return { kind: 'build', screen: sk }
	return { kind: 'generic' }
}

// ------------------------------------------------------------------ provider

export class MockProvider implements LLMProvider {
	readonly name = 'mock'

	async complete(messages: ChatMessage[], _tools: ToolDef[], _signal: AbortSignal, handlers?: StreamHandlers): Promise<Completion> {
		// Replay the scripted reply through the same assembler the real provider uses.
		const { text, toolCalls } = this.script(messages)
		const assembler = new StreamAssembler(handlers)
		if (text) assembler.push({ content: text })
		toolCalls.forEach((c, index) => assembler.push({ tool_calls: [{ index, id: c.id, function: c.function }] }))
		return assembler.finish()
	}

	private script(messages: ChatMessage[]): Completion {
		// Find the message that started this turn and how many steps we've taken since.
		let start = messages.length - 1
		while (start >= 0 && !(messages[start].role === 'user' && textOf(messages[start]).startsWith('[trigger:'))) start--
		const trigger = start >= 0 ? textOf(messages[start]) : ''
		const step = messages.slice(start + 1).filter((m) => m.role === 'assistant').length
		const lastTool = [...messages].reverse().find((m) => m.role === 'tool')

		if (trigger.startsWith('[trigger:check_work]') || trigger.startsWith('[trigger:idle]')) {
			return this.critique(trigger, step, lastTool)
		}
		const said = trigger.match(/ says: ([\s\S]*?)(?:\n\((?:The user just heard|You already said|A quick acknowledgement)|$)/)?.[1]?.trim() ?? trigger
		return this.respond(said, parseEdit(said), step, lastTool)
	}

	// ---------------------------------------------------------------- critique

	private critique(trigger: string, step: number, lastTool: ChatMessage | undefined): Completion {
		const idle = trigger.startsWith('[trigger:idle]')
		if (step === 0) {
			return { text: 'Let me critique what is on the canvas.', toolCalls: [call('get_canvas_state', { audit: true })] }
		}
		if (step === 1) {
			const all = parseScreens(lastTool)
			const requester = trigger.match(/\n([^\n]+?) pressed "Critique"/)?.[1]?.trim()
			// What collaborators just changed: critique that first, addressed to whoever changed it.
			const edited = recentEdits(trigger)
			let focus: { node: TreeNode; screen: TreeNode; by: string } | undefined
			for (const e of edited.filter((e) => !requester || e.by === requester)) {
				for (const screen of all) {
					const node = screen.id === e.id ? screen : descendants(screen).find((x) => x.id === e.id)
					if (node) {
						focus = { node, screen, by: e.by }
						break
					}
				}
				if (focus) break
			}
			const mine = all.filter((s) => s.user)
			const screens = focus ? [focus.screen] : mine.length ? mine : idle ? [] : all
			if (!screens.length) {
				if (idle) return { text: 'SILENT', toolCalls: [] }
				return { text: "I don't see a design to critique yet. Ask me to build a screen and we can iterate on it.", toolCalls: [] }
			}
			const screen = screens[screens.length - 1]
			const owner: string | undefined = focus?.by ?? screen.raw?.author?.name ?? screen.raw?.meta?.author?.name ?? requester
			const who = owner ? `${owner}, ` : ''
			const title = focus?.node ?? titleNode(screen) ?? screen
			const nodes = descendants(screen)
			// Only measured problems are claimed (the executor's audit), never guessed ones.
			let audit: { id: string; screen: string; kind: string; detail: string }[] = []
			try {
				audit = JSON.parse(textOf(lastTool!)).audit ?? []
			} catch {}
			const issue = audit.find((i) => i.screen === screen.id && nodes.some((x) => x.id === i.id) && ['touch', 'small_text', 'contrast', 'clipped'].includes(i.kind))
			const ISSUE_TEXT: Record<string, [string, string]> = {
				touch: ['This button is under 44 pixels tall, which is hard to tap on a phone.', ' The button looks a bit small to tap, though.'],
				small_text: ['This text is under 12 pixels and may be hard to read.', ' That small text may be hard to read.'],
				contrast: ['This text has low contrast against its background.', ' That text has low contrast, though.'],
				clipped: ['This label is clipped: it needs a wider box or shorter copy.', ' One label is clipped, though.'],
			}
			const btn = primaryButton(screen)
			const praiseText = focus
				? `Your change to ${title.text ? `"${title.text}"` : `the ${title.type}`} fits the rest of the screen well.`
				: title.text
					? `The "${title.text}" title makes the purpose of this screen clear.`
					: 'The structure of this screen is easy to scan.'
			const toolCalls: ToolCall[] = [
				call('highlight_shapes', { id: 'review_hl_good', shapeIds: [title.id], color: 'green' }),
				call('add_comment', { id: 'review_praise', targetShapeId: title.id, kind: 'praise', text: praiseText, addressedTo: owner }),
			]
			let spoken = focus ? `${who}nice touch on the ${title.type === 'text' ? 'copy' : title.type}. It reads clearly.` : `${who}nice work. The title is clear and easy to find.`
			const flagged = issue ? nodes.find((x) => x.id === issue.id) : undefined
			if (flagged && issue) {
				toolCalls.push(
					call('highlight_shapes', { id: 'review_hl_issue', shapeIds: [flagged.id], color: 'orange' }),
					call('add_comment', {
						id: 'review_issue',
						targetShapeId: flagged.id,
						kind: 'issue',
						text: ISSUE_TEXT[issue.kind][0],
						addressedTo: owner,
					})
				)
				spoken += ISSUE_TEXT[issue.kind][1]
			} else {
				const target = btn ?? mainContent(screen)
				toolCalls.push(
					call('highlight_shapes', { id: 'review_hl_tip', shapeIds: [target.id], color: 'blue' }),
					call('add_comment', {
						id: 'review_suggestion',
						targetShapeId: target.id,
						kind: 'suggestion',
						text: btn ? 'Consider making the main action stand out even more with a bolder label or more breathing room.' : 'Consider adding a clear primary action here.',
						addressedTo: owner,
					})
				)
				spoken += btn ? ' One idea: give the main button a little more emphasis.' : ' One idea: add a clear primary action.'
			}
			return { text: spoken, toolCalls }
		}
		if (step === 2) return { text: 'Want me to apply those suggestions, or look at another screen?', toolCalls: [] }
		return { text: null, toolCalls: [] }
	}

	// ---------------------------------------------------------------- design & edits

	private respond(said: string, edit: Edit, step: number, lastTool: ChatMessage | undefined): Completion {
		switch (edit.kind) {
			case 'build':
				return this.build(edit.screen, step)
			case 'theme':
				if (step === 0) {
					return {
						text: edit.mode === 'dark' ? 'Switching everything to dark mode.' : 'Back to light mode.',
						toolCalls: [call('set_theme', { screenId: 'all', mode: edit.mode })],
					}
				}
				return step === 1 ? { text: 'How does that feel? Want a different accent color too?', toolCalls: [] } : { text: null, toolCalls: [] }
			case 'generic': {
				const { spec, name } = genericScreen(said)
				if (step === 0) return { text: `Let me sketch a first draft of ${name}.`, toolCalls: [call('create_screen', spec), call('focus_view', { shapeIds: [spec.id], scope: 'requester' })] }
				return step === 1 ? { text: 'There is a first pass. What is the main thing someone should do here?', toolCalls: [] } : { text: null, toolCalls: [] }
			}
			case 'add_screen':
				return this.addScreen(edit, step, lastTool)
			default:
				return this.edit(edit, said, step, lastTool)
		}
	}

	private build(kind: string, step: number): Completion {
		const none: Completion = { text: null, toolCalls: [] }
		switch (kind) {
			case 'login':
				if (step === 0) return { text: 'Here is a clean mobile login with email, password and a clear main button.', toolCalls: [call('create_screen', loginScreen())] }
				if (step === 1) return { text: 'I will add social sign-in options under the button.', toolCalls: [call('add_nodes', { parentId: 'login_content', nodes: loginSocial() }), call('focus_view', { shapeIds: ['login'], scope: 'requester' })] }
				return step === 2 ? { text: 'Want a sign-up screen connected to this one?', toolCalls: [] } : none
			case 'signup':
				if (step === 0) return { text: 'Here is a simple sign-up screen with the essentials only.', toolCalls: [call('create_screen', signupScreen()), call('focus_view', { shapeIds: ['signup'], scope: 'requester' })] }
				return step === 1 ? { text: 'Should sign-up ask for a phone number too, or keep it to email?', toolCalls: [] } : none
			case 'dashboard':
				if (step === 0) return { text: 'Starting a dashboard with a header, four key stats, a revenue chart and top products.', toolCalls: [call('create_screen', dashboardScreen())] }
				if (step === 1) return { text: 'Now a recent activity list under the chart.', toolCalls: [call('add_nodes', { parentId: 'dash_content', nodes: [dashActivity()] }), call('focus_view', { shapeIds: ['dashboard'], scope: 'requester' })] }
				return step === 2 ? { text: 'Should the dashboard lead with revenue, or something else like active users?', toolCalls: [] } : none
			case 'landing':
				if (step === 0) return { text: 'Here is a landing page with a nav bar and a bold hero.', toolCalls: [call('create_screen', landingScreen())] }
				if (step === 1) return { text: 'And feature cards, a customer quote and a closing call to action below the hero.', toolCalls: [call('add_nodes', { parentId: 'landing', nodes: [landingFeatures(), landingTestimonial(), frame('landing_cta_wrap', [landingCta()], { padding: [0, 80, 32, 80] }), landingFooter()] }), call('focus_view', { shapeIds: ['landing'], scope: 'requester' })] }
				return step === 2 ? { text: 'Want a pricing section next, or testimonials?', toolCalls: [] } : none
			case 'onboarding':
				if (step === 0) return { text: 'First onboarding step: an illustration, a short headline and a Next button.', toolCalls: [call('create_screen', onboardingScreen(1, 'Plan trips together', 'Invite friends and build an itinerary in one shared place.'))] }
				if (step === 1) {
					return {
						text: 'And the second step, wired to the first.',
						toolCalls: [
							call('create_screen', onboardingScreen(2, 'Everything in one place', 'Tickets, maps and notes, all available offline.')),
							call('connect_screens', { id: 'flow_onb1_onb2', fromId: 'onb1_next', toId: 'onb2', label: 'Next' }),
							call('focus_view', { shapeIds: ['onb1', 'onb2'], scope: 'requester' }),
						],
					}
				}
				return step === 2 ? { text: 'Should there be a third step, or go straight to sign-up?', toolCalls: [] } : none
			case 'settings':
				if (step === 0) return { text: 'Here is a settings screen with grouped rows, toggles and a log out button.', toolCalls: [call('create_screen', settingsScreen()), call('focus_view', { shapeIds: ['settings'], scope: 'requester' })] }
				return step === 1 ? { text: 'Which settings matter most to your users? I can reorder them.', toolCalls: [] } : none
		}
		return none
	}

	private addScreen(edit: Extract<Edit, { kind: 'add_screen' }>, step: number, lastTool: ChatMessage | undefined): Completion {
		if (step === 0) return { text: 'Let me see what is on the canvas first.', toolCalls: [call('get_canvas_state', {})] }
		if (step === 1) {
			const screens = parseScreens(lastTool)
			const from = screens[screens.length - 1]
			const kind = edit.what === 'generic' ? 'signup' : edit.what
			const spec = { login: loginScreen, signup: signupScreen, dashboard: dashboardScreen, landing: landingScreen, settings: settingsScreen, onboarding: () => onboardingScreen(1, 'Welcome', 'Let us get you set up.') }[kind]!()
			const calls = [call('create_screen', spec)]
			let spoken = `Here is the new ${spec.name} screen`
			if (from && from.id !== spec.id) {
				const link = descendants(from).find((x) => /signup_link|_link$/.test(x.id)) ?? primaryButton(from)
				calls.push(call('connect_screens', { id: `flow_${from.id}_${spec.id}`, fromId: link?.id ?? from.id, toId: spec.id, label: kind === 'signup' ? 'Sign up' : 'Next' }))
				spoken += ', and I connected it to the previous screen'
			}
			spoken += '.'
			calls.push(call('focus_view', { shapeIds: from ? [from.id, spec.id] : [spec.id], scope: 'requester' }))
			return { text: spoken, toolCalls: calls }
		}
		return step === 2 ? { text: 'Should the flow continue after this screen, or is this the end?', toolCalls: [] } : { text: null, toolCalls: [] }
	}

	private edit(edit: Edit, said: string, step: number, lastTool: ChatMessage | undefined): Completion {
		if (step === 0) return { text: 'One moment, checking the current design.', toolCalls: [call('get_canvas_state', {})] }
		if (step > 2) return { text: null, toolCalls: [] }
		const question = (q: string): Completion => ({ text: q, toolCalls: [] })
		// Step 2 follows the edit itself (lastTool is its result, not the canvas).
		if (step === 2) {
			if (lastTool && /"ok":false/.test(textOf(lastTool))) return question('Okay, I left that as it is. What should we change instead?')
			const q: Partial<Record<Edit['kind'], string>> = {
				color: 'How does that look? Want the rest of the accents to match?',
				rename: 'Better? I can tweak the supporting text to match.',
				delete: 'Gone. Anything else you want to simplify?',
				add_component: 'Added. Want it styled differently, or moved higher up?',
			}
			return question(q[edit.kind] ?? 'What should we refine next?')
		}
		const screens = parseScreens(lastTool)
		const screen = screens[screens.length - 1]
		if (!screen) {
			const { spec, name } = genericScreen(said)
			return { text: `There is nothing on the canvas to change yet, so I started ${name} for you.`, toolCalls: [call('create_screen', spec)] }
		}

		switch (edit.kind) {
			case 'color': {
				const btn = primaryButton(screen)
				if (!btn) return question('I do not see a button on this screen. Want me to add one?')
				return { text: `Making the button ${edit.colorName}.`, toolCalls: [call('update_node', { id: btn.id, fill: edit.color })] }
			}
			case 'rename': {
				const target = edit.target.startsWith('button') ? primaryButton(screen) : titleNode(screen)
				if (!target) return question('I could not find that on this screen. Which element do you mean?')
				return { text: `Changing it to ${edit.text}.`, toolCalls: [call('update_node', { id: target.id, text: edit.text })] }
			}
			case 'delete': {
				const w = edit.what.replace(/\b(please|from the screen|on the screen)\b/g, '').trim()
				// Look on the newest screen first, then the others.
				// "the welcome back text" -> match "welcome back" against node text too.
				const phrases = [w, w.replace(/\s+(text|label|button|input|field|image|toggle|checkbox|icon)$/, '')].filter((p, i, a) => p && a.indexOf(p) === i)
				let target: TreeNode | undefined
				for (const p of phrases) {
					for (const s of [...screens].reverse()) {
						const nodes = descendants(s)
						target = nodes.find((x) => x.text && x.text.toLowerCase().includes(p)) ?? nodes.find((x) => x.name.toLowerCase().includes(p) || x.id.toLowerCase().includes(p.replace(/\s+/g, '_')))
						if (target) break
					}
					if (target) break
				}
				const nodes = descendants(screen)
				target ??= nodes.find((x) => x.type === w.split(/\s+/).pop() || x.type === w.replace(/s$/, ''))
				if (!target) return question('I could not find that on this screen. Which element do you mean?')
				return { text: `Removing ${target.text ? `"${target.text}"` : 'it'}.`, toolCalls: [call('delete_nodes', { ids: [target.id] })] }
			}
			case 'add_component': {
				const parent = mainContent(screen)
				const id = `added_${edit.component}_${++n}`
				const nodes: Record<string, Spec> = {
					button: { id, type: 'button', name: 'Button', text: edit.label ?? 'Continue', width: 'fill' },
					input: { id, type: 'input', name: 'Input', icon: 'search', text: edit.label ?? 'Enter text' },
					image: { id, type: 'image', name: 'Image', width: 'fill', height: 160 },
					toggle: row(id, [txt(`${id}_label`, edit.label ?? 'Enable feature', { width: 'fill' }), { id: `${id}_toggle`, type: 'toggle', name: 'Toggle', checked: true }], { name: 'Toggle row', width: 'fill', gap: 12 }),
					checkbox: { id, type: 'checkbox', name: 'Checkbox', text: edit.label ?? 'Remember me', checked: true },
					text: txt(id, edit.label ?? 'New text', { name: 'Text', fontSize: 16 }),
				}
				return {
					text: `Adding a ${edit.component} to the ${parent.name || 'content'} area.`,
					toolCalls: [call('add_nodes', { parentId: parent.id, nodes: [nodes[edit.component] ?? nodes.text] })],
				}
			}
		}
		return question('What should we refine next?')
	}
}
