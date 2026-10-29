// Sample data for the launch video: the scripted mock agent's screen specs
// (copied from server/src/mock.ts, which the browser cannot import), fed to the
// app's real CanvasExecutor exactly as the agent's create_screen calls are.
/* eslint-disable */

// ------------------------------------------------------------------ spec helpers

type Spec = Record<string, any>
const txt = (id: string, text: string, extra: Spec = {}): Spec => ({ id, type: 'text', text, ...extra })
const muted = (id: string, text: string, extra: Spec = {}): Spec => txt(id, text, { textColor: '$muted', fontSize: 14, ...extra })
const frame = (id: string, children: Spec[], extra: Spec = {}): Spec => ({ id, type: 'frame', children, ...extra })
const row = (id: string, children: Spec[], extra: Spec = {}): Spec => frame(id, children, { layout: 'horizontal', alignItems: 'center', ...extra })
const secondaryBtn = (id: string, text: string, extra: Spec = {}): Spec => ({ id, type: 'button', text, fill: '$surface', textColor: '$text', stroke: '$border', strokeWidth: 1, ...extra })


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

export function loginScreen(): Spec {
	return {
		id: 'login',
		name: 'Login',
		device: 'iphone',
		layout: 'vertical',
		gap: 24,
		padding: [64, 24, 40, 24],
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
					// The footer ends the centered content (no dead gap above a bottom-anchored row).
					row('login_footer', [muted('login_footer_text', "Don't have an account?"), txt('login_signup_link', 'Sign up', { textColor: '$primary', fontSize: 14, fontWeight: 600 })], {
						width: 'fill',
						justify: 'center',
						gap: 4,
					}),
				],
				{ width: 'fill', height: 'fill', gap: 28, alignItems: 'stretch', justify: 'center' }
			),
		],
	}
}

export const loginSocial = (): Spec[] => [
	row('login_or', [{ id: 'login_or_l', type: 'divider', name: 'Divider', width: 'fill' }, muted('login_or_text', 'or continue with'), { id: 'login_or_r', type: 'divider', name: 'Divider', width: 'fill' }], { width: 'fill', gap: 16 }),
	row('login_social', [secondaryBtn('login_google_btn', 'Google', { width: 'fill', icon: 'google' }), secondaryBtn('login_apple_btn', 'Apple', { width: 'fill', icon: 'apple' })], { width: 'fill', gap: 12 }),
]

export function signupScreen(): Spec {
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

export function dashboardScreen(): Spec {
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

export const dashActivity = (): Spec =>
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


// ------------------------------------------------------------------ video variants

/** Coffee brand used across the video (what the agent picks for "a coffee app"). */
export const COFFEE = '#7a4a2b'

const swap = (node: Spec, fn: (n: Spec) => Spec): Spec => {
	const out = fn({ ...node })
	if (Array.isArray(out.children)) out.children = out.children.map((c: Spec) => swap(c, fn))
	return out
}

/** The mock login, as built for "Design a login screen for a coffee app" (with its social row). */
export function coffeeLogin(): Spec {
	const spec = swap(loginScreen(), (n) => {
		if (n.id === 'login_logo') return { ...n, icon: 'coffee' }
		if (n.id === 'login_subtitle') return { ...n, text: 'Log in to order your usual.' }
		return n
	})
	const content = spec.children[0]
	content.children.splice(3, 0, ...loginSocial())
	return { ...spec, name: 'Login', primary: COFFEE }
}

export function coffeeSignup(): Spec {
	return { ...signupScreen(), name: 'Sign up', primary: COFFEE }
}
