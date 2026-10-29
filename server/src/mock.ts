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

function loginScreen(): Spec {
	return {
		id: 'login',
		name: 'Login',
		device: 'iphone',
		layout: 'vertical',
		gap: 16,
		padding: [64, 24, 32, 24],
		alignItems: 'stretch',
		children: [
			frame(
				'login_content',
				[
					frame('login_header', [
						frame('login_logo', [{ id: 'login_logo_icon', type: 'icon', icon: 'lock', textColor: '$onPrimary' }], {
							width: 64,
							height: 64,
							fill: '$primary',
							radius: 16,
							alignItems: 'center',
							justify: 'center',
						}),
						txt('login_title', 'Welcome back', { fontSize: 32, fontWeight: 700 }),
						muted('login_subtitle', 'Log in to pick up where you left off.', { fontSize: 16 }),
					], { gap: 8 }),
					frame('login_form', [
						{ id: 'login_email', type: 'input', icon: 'mail', text: 'Email address' },
						{ id: 'login_password', type: 'input', icon: 'lock', text: 'Password' },
						muted('login_forgot', 'Forgot password?', { textColor: '$primary', align: 'right', width: 'fill', fontWeight: 500 }),
					], { gap: 16 }),
					{ id: 'login_primary_btn', type: 'button', text: 'Log in', width: 'fill' },
				],
				{ width: 'fill', height: 'fill', gap: 24, justify: 'center', alignItems: 'stretch' }
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
	row('login_or', [{ id: 'login_or_l', type: 'divider', width: 'fill' }, muted('login_or_text', 'or'), { id: 'login_or_r', type: 'divider', width: 'fill' }], { width: 'fill', gap: 12 }),
	secondaryBtn('login_google_btn', 'Continue with Google', { width: 'fill', icon: 'user' }),
	secondaryBtn('login_apple_btn', 'Continue with Apple', { width: 'fill', icon: 'user' }),
]

function signupScreen(): Spec {
	return {
		id: 'signup',
		name: 'Sign up',
		device: 'iphone',
		layout: 'vertical',
		gap: 16,
		padding: [64, 24, 32, 24],
		alignItems: 'stretch',
		children: [
			frame(
				'signup_content',
				[
					frame('signup_header', [
						txt('signup_title', 'Create your account', { fontSize: 32, fontWeight: 700 }),
						muted('signup_subtitle', 'It only takes a minute.', { fontSize: 16 }),
					], { gap: 8 }),
					frame('signup_form', [
						{ id: 'signup_name', type: 'input', icon: 'user', text: 'Full name' },
						{ id: 'signup_email', type: 'input', icon: 'mail', text: 'Email address' },
						{ id: 'signup_password', type: 'input', icon: 'lock', text: 'Password' },
						{ id: 'signup_terms', type: 'checkbox', text: 'I agree to the Terms of Service', checked: true },
					], { gap: 16 }),
					{ id: 'signup_primary_btn', type: 'button', text: 'Create account', width: 'fill' },
				],
				{ width: 'fill', height: 'fill', gap: 24, justify: 'center', alignItems: 'stretch' }
			),
			row('signup_footer', [muted('signup_footer_text', 'Already have an account?'), txt('signup_login_link', 'Log in', { textColor: '$primary', fontSize: 14, fontWeight: 600 })], {
				width: 'fill',
				justify: 'center',
				gap: 4,
			}),
		],
	}
}

const statCard = (key: string, label: string, value: string, delta: string, up = true): Spec =>
	frame(`dash_stat_${key}`, [muted(`dash_stat_${key}_label`, label), txt(`dash_stat_${key}_value`, value, { fontSize: 32, fontWeight: 700 }), muted(`dash_stat_${key}_delta`, delta, { textColor: up ? '#16a34a' : '#dc2626' })], {
		width: 'fill',
		gap: 8,
		padding: 24,
		fill: '$surface',
		stroke: '$border',
		strokeWidth: 1,
		radius: 16,
		shadow: 'sm',
	})

function dashboardScreen(): Spec {
	return {
		id: 'dashboard',
		name: 'Dashboard',
		device: 'desktop',
		layout: 'vertical',
		gap: 24,
		padding: [32, 48, 32, 48],
		alignItems: 'stretch',
		children: [
			row('dash_header', [
				frame('dash_heading', [txt('dash_title', 'Dashboard', { fontSize: 32, fontWeight: 700 }), muted('dash_subtitle', "Here's how your store is doing this week.", { fontSize: 16 })], { gap: 4 }),
				row('dash_user', [{ id: 'dash_bell', type: 'icon', icon: 'bell' }, { id: 'dash_avatar', type: 'avatar', text: 'AK' }], { gap: 16 }),
			], { width: 'fill', justify: 'space-between' }),
			frame(
				'dash_content',
				[
					row('dash_stats', [statCard('revenue', 'Revenue', '$48,230', '+12.4% vs last week'), statCard('orders', 'Orders', '1,284', '+5.1% vs last week'), statCard('refunds', 'Refunds', '37', '+2.3% vs last week', false)], { width: 'fill', gap: 24, alignItems: 'stretch' }),
					frame('dash_chart', [txt('dash_chart_title', 'Revenue over time', { fontSize: 18, fontWeight: 600 }), { id: 'dash_chart_img', type: 'image', name: 'Chart', width: 'fill', height: 240 }], {
						width: 'fill',
						gap: 16,
						padding: 24,
						fill: '$surface',
						stroke: '$border',
						strokeWidth: 1,
						radius: 16,
					}),
				],
				{ width: 'fill', height: 'fill', gap: 24, alignItems: 'stretch' }
			),
		],
	}
}

const activityRow = (key: string, who: string, what: string, amount: string): Spec =>
	row(`dash_row_${key}`, [
		{ id: `dash_row_${key}_avatar`, type: 'avatar', text: who.slice(0, 2).toUpperCase() },
		frame(`dash_row_${key}_info`, [txt(`dash_row_${key}_name`, who, { fontWeight: 600 }), muted(`dash_row_${key}_what`, what)], { gap: 2, width: 'fill' }),
		txt(`dash_row_${key}_amount`, amount, { fontWeight: 600 }),
	], { width: 'fill', gap: 12, padding: [12, 0, 12, 0] })

const dashActivity = (): Spec =>
	frame('dash_activity', [
		txt('dash_activity_title', 'Recent activity', { fontSize: 18, fontWeight: 600 }),
		activityRow('1', 'Maya Chen', 'Order #1042, 3 items', '$128.00'),
		{ id: 'dash_div_1', type: 'divider', width: 'fill' },
		activityRow('2', 'Leo Park', 'Order #1041, 1 item', '$54.90'),
		{ id: 'dash_div_2', type: 'divider', width: 'fill' },
		activityRow('3', 'Sam Ortiz', 'Order #1040, 2 items', '$87.50'),
	], { width: 'fill', gap: 8, padding: 24, fill: '$surface', stroke: '$border', strokeWidth: 1, radius: 16 })

function landingScreen(): Spec {
	return {
		id: 'landing',
		name: 'Landing page',
		device: 'desktop',
		layout: 'vertical',
		gap: 0,
		padding: 0,
		alignItems: 'stretch',
		children: [
			row('landing_nav', [
				row('landing_brand', [{ id: 'landing_logo', type: 'icon', icon: 'star', textColor: '$primary' }, txt('landing_brand_name', 'Acme', { fontSize: 20, fontWeight: 700 })], { gap: 8 }),
				row('landing_links', [txt('landing_link_1', 'Product', { textColor: '$muted' }), txt('landing_link_2', 'Pricing', { textColor: '$muted' }), txt('landing_link_3', 'About', { textColor: '$muted' })], { gap: 32 }),
				{ id: 'landing_nav_cta', type: 'button', text: 'Get started' },
			], { width: 'fill', justify: 'space-between', padding: [20, 64, 20, 64] }),
			frame(
				'landing_hero',
				[
					txt('landing_eyebrow', 'Introducing Acme 2.0', { textColor: '$primary', fontSize: 14, fontWeight: 600 }),
					txt('landing_headline', 'Design faster, together', { fontSize: 56, fontWeight: 700, align: 'center' }),
					muted('landing_sub', 'Describe what you want and watch it appear. Share it with your team in one click.', { fontSize: 20, align: 'center', width: 640 }),
					row('landing_cta', [{ id: 'landing_primary_btn', type: 'button', text: 'Start free' }, secondaryBtn('landing_secondary_btn', 'Watch demo')], { gap: 16 }),
					{ id: 'landing_hero_img', type: 'image', name: 'Product shot', width: 960, height: 360, radius: 20 },
				],
				{ width: 'fill', gap: 24, alignItems: 'center', padding: [96, 64, 64, 64] }
			),
		],
	}
}

const featureCard = (key: string, icon: string, title: string, body: string): Spec =>
	frame(`landing_feature_${key}`, [
		frame(`landing_feature_${key}_icon`, [{ id: `landing_feature_${key}_glyph`, type: 'icon', icon, textColor: '$primary' }], { width: 48, height: 48, fill: '$surfaceAlt', radius: 12, alignItems: 'center', justify: 'center' }),
		txt(`landing_feature_${key}_title`, title, { fontSize: 20, fontWeight: 600 }),
		muted(`landing_feature_${key}_body`, body, { fontSize: 16 }),
	], { width: 'fill', gap: 12, padding: 24, fill: '$surface', stroke: '$border', strokeWidth: 1, radius: 16 })

const landingFeatures = (): Spec =>
	row('landing_features', [
		featureCard('speed', 'star', 'Lightning fast', 'Go from idea to a clickable draft in seconds.'),
		featureCard('team', 'user', 'Built for teams', 'Invite anyone and design together in real time.'),
		featureCard('share', 'check', 'Ship with confidence', 'Export clean code and hand it straight to engineers.'),
	], { width: 'fill', gap: 24, alignItems: 'stretch', padding: [32, 64, 64, 64] })

function onboardingScreen(i: number, title: string, desc: string, last = false): Spec {
	const id = `onb${i}`
	return {
		id,
		name: `Onboarding ${i}`,
		device: 'iphone',
		layout: 'vertical',
		gap: 24,
		padding: [64, 24, 32, 24],
		alignItems: 'stretch',
		children: [
			frame(
				`${id}_content`,
				[
					{ id: `${id}_img`, type: 'image', name: 'Illustration', width: 'fill', height: 320, radius: 24 },
					txt(`${id}_title`, title, { fontSize: 28, fontWeight: 700, align: 'center', width: 'fill' }),
					muted(`${id}_desc`, desc, { fontSize: 16, align: 'center', width: 'fill' }),
					row(`${id}_dots`, [1, 2, 3].map((d) => ({ id: `${id}_dot_${d}`, type: 'rect', width: d === i ? 24 : 8, height: 8, radius: 4, fill: d === i ? '$primary' : '$border' })), { gap: 8, justify: 'center' }),
				],
				{ width: 'fill', height: 'fill', gap: 24, alignItems: 'center', justify: 'center' }
			),
			frame(`${id}_footer`, [
				{ id: `${id}_next`, type: 'button', text: last ? 'Get started' : 'Next', width: 'fill' },
				{ id: `${id}_skip`, type: 'button', text: 'Skip', width: 'fill', fill: 'transparent', textColor: '$muted' },
			], { width: 'fill', gap: 8, alignItems: 'stretch' }),
		],
	}
}

const settingsRow = (key: string, icon: string, label: string, trailing: 'toggle' | 'arrow', checked = false): Spec =>
	row(`settings_${key}`, [
		{ id: `settings_${key}_icon`, type: 'icon', icon, textColor: '$primary' },
		txt(`settings_${key}_label`, label, { width: 'fill' }),
		trailing === 'toggle' ? { id: `settings_${key}_toggle`, type: 'toggle', checked } : { id: `settings_${key}_arrow`, type: 'icon', icon: 'arrow-right', textColor: '$muted' },
	], { width: 'fill', gap: 12, padding: [14, 16, 14, 16] })

function settingsScreen(): Spec {
	const card = (id: string, rows: Spec[]) => {
		const kids: Spec[] = []
		rows.forEach((r, i) => {
			if (i) kids.push({ id: `${id}_div_${i}`, type: 'divider', width: 'fill' })
			kids.push(r)
		})
		return frame(id, kids, { width: 'fill', gap: 0, fill: '$surface', stroke: '$border', strokeWidth: 1, radius: 16 })
	}
	return {
		id: 'settings',
		name: 'Settings',
		device: 'iphone',
		layout: 'vertical',
		gap: 24,
		padding: [64, 24, 32, 24],
		alignItems: 'stretch',
		children: [
			txt('settings_title', 'Settings', { fontSize: 32, fontWeight: 700 }),
			frame(
				'settings_content',
				[
					card('settings_account', [settingsRow('profile', 'user', 'Profile', 'arrow'), settingsRow('email', 'mail', 'Email', 'arrow'), settingsRow('password', 'lock', 'Password', 'arrow')]),
					card('settings_prefs', [settingsRow('notifications', 'bell', 'Notifications', 'toggle', true), settingsRow('darkmode', 'star', 'Dark mode', 'toggle')]),
					secondaryBtn('settings_logout_btn', 'Log out', { width: 'fill', textColor: '#dc2626' }),
				],
				{ width: 'fill', height: 'fill', gap: 24, alignItems: 'stretch' }
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
					txt(`${id}_title`, name, { fontSize: 32, fontWeight: 700 }),
					muted(`${id}_subtitle`, 'A first draft based on your idea. Tell me what to change.', { fontSize: 16 }),
					{ id: `${id}_image`, type: 'image', name: 'Hero image', width: 'fill', height: 200 },
					{ id: `${id}_input`, type: 'input', icon: 'search', text: 'Search' },
					row(`${id}_cards`, [
						frame(`${id}_card_1`, [txt(`${id}_card_1_title`, 'Item one', { fontWeight: 600 }), muted(`${id}_card_1_body`, 'Short description')], { width: 'fill', gap: 4, padding: 16, fill: '$surface', stroke: '$border', strokeWidth: 1, radius: 12 }),
						frame(`${id}_card_2`, [txt(`${id}_card_2_title`, 'Item two', { fontWeight: 600 }), muted(`${id}_card_2_body`, 'Short description')], { width: 'fill', gap: 4, padding: 16, fill: '$surface', stroke: '$border', strokeWidth: 1, radius: 12 }),
					], { width: 'fill', gap: 12, alignItems: 'stretch' }),
					{ id: `${id}_primary_btn`, type: 'button', text: 'Continue', width: 'fill' },
				], { width: 'fill', height: 'fill', gap: 16, alignItems: 'stretch' }),
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
		const said = trigger.match(/ says: ([\s\S]*?)(?:\n\((?:The user just heard|You already said)|$)/)?.[1]?.trim() ?? trigger
		return this.respond(said, parseEdit(said), step, lastTool)
	}

	// ---------------------------------------------------------------- critique

	private critique(trigger: string, step: number, lastTool: ChatMessage | undefined): Completion {
		const idle = trigger.startsWith('[trigger:idle]')
		if (step === 0) {
			return { text: 'Let me critique what is on the canvas.', toolCalls: [call('get_canvas_state', {})] }
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
			const tinyText = nodes.find((x) => x.type === 'text' && Number(x.raw?.fontSize) > 0 && Number(x.raw?.fontSize) < 14)
			const smallBtn = nodes.find((x) => x.type === 'button' && Number(x.raw?.h ?? x.raw?.height) > 0 && Number(x.raw?.h ?? x.raw?.height) < 44)
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
			const flagged = smallBtn ?? (tinyText ? tinyText : undefined)
			if (flagged) {
				toolCalls.push(
					call('highlight_shapes', { id: 'review_hl_issue', shapeIds: [flagged.id], color: 'orange' }),
					call('add_comment', {
						id: 'review_issue',
						targetShapeId: flagged.id,
						kind: 'issue',
						text: flagged.type === 'button' ? 'This button is under 44 pixels tall, which is hard to tap on a phone.' : 'This text is smaller than 14 pixels and may be hard to read.',
						addressedTo: owner,
					})
				)
				spoken += flagged.type === 'button' ? ' The button looks a bit small to tap, though.' : ' That small text may be hard to read.'
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
				if (step === 0) return { text: 'Starting a dashboard with a header, three key stats and a revenue chart.', toolCalls: [call('create_screen', dashboardScreen())] }
				if (step === 1) return { text: 'Now a recent activity list under the chart.', toolCalls: [call('add_nodes', { parentId: 'dash_content', nodes: [dashActivity()] }), call('focus_view', { shapeIds: ['dashboard'], scope: 'requester' })] }
				return step === 2 ? { text: 'Should the dashboard lead with revenue, or something else like active users?', toolCalls: [] } : none
			case 'landing':
				if (step === 0) return { text: 'Here is a landing page with a nav bar and a bold hero.', toolCalls: [call('create_screen', landingScreen())] }
				if (step === 1) return { text: 'And a row of three feature cards below the hero.', toolCalls: [call('add_nodes', { parentId: 'landing', nodes: [landingFeatures()] }), call('focus_view', { shapeIds: ['landing'], scope: 'requester' })] }
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
			let spoken = `Here is the new ${spec.name} screen.`
			if (from && from.id !== spec.id) {
				const link = descendants(from).find((x) => /signup_link|_link$/.test(x.id)) ?? primaryButton(from)
				calls.push(call('connect_screens', { id: `flow_${from.id}_${spec.id}`, fromId: link?.id ?? from.id, toId: spec.id, label: kind === 'signup' ? 'Sign up' : 'Next' }))
				spoken += ' I connected it to the previous screen.'
			}
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
