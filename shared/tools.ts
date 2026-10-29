// Tool (function) definitions given to Grok. Kept in one place so the server
// (which sends them to the model) and the client (which executes them on the
// tldraw editor) agree on names and argument shapes. The design model behind
// them lives in shared/design.ts.

import { DEVICES, ICONS } from './design.ts'

export type ToolDef = {
	name: string
	description: string
	parameters: Record<string, unknown>
}

const region = {
	type: 'object',
	description: 'Page-space bounding box',
	properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
}

const colorValue = (what: string) => ({
	type: 'string',
	description: `${what}. Prefer theme tokens so light/dark mode works: $bg $surface $surfaceAlt $primary $primarySoft $onPrimary $text $muted $border $success $successSoft $warning $warningSoft $danger $dangerSoft $info $infoSoft. Also accepts '#rrggbb' or 'transparent'.`,
})
const sizeValue = (axis: string) => ({
	description: `${axis}: a number of px (fixed), 'fill' (take the remaining space in the parent) or 'hug' (shrink to content). Defaults depend on type.`,
	anyOf: [{ type: 'number' }, { type: 'string', enum: ['fill', 'hug'] }],
})

/** Auto-layout fields shared by screens and frames. */
const layoutProps = {
	layout: {
		type: 'string',
		enum: ['vertical', 'horizontal', 'none'],
		description: "Auto layout direction of the children (like Figma). 'none' = children positioned by their own x/y.",
	},
	gap: { type: 'number', description: 'Space between children in px (use the 8px scale: 4, 8, 12, 16, 24, 32).' },
	padding: {
		description: 'Inner padding: a number, or [vertical, horizontal], or [top, right, bottom, left].',
		anyOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
	},
	alignItems: {
		type: 'string',
		enum: ['start', 'center', 'end', 'stretch'],
		description:
			"Cross-axis alignment. 'stretch' makes children whose size on that axis is 'hug' fill it (default for vertical stacks: full-width text, buttons). Use 'center' to keep hugging buttons/texts their natural width and centered.",
	},
	justify: { type: 'string', enum: ['start', 'center', 'end', 'space-between'], description: 'Main-axis distribution.' },
}

/** Every visual prop of a node (everything except id/type/children). */
const nodeProps = {
	name: { type: 'string', description: 'Layer name shown in the Layers panel.' },
	text: { type: 'string', description: 'Text content: text body, button label, input placeholder, checkbox label, avatar name (initials are shown), image caption.' },
	icon: { type: 'string', enum: ICONS, description: 'Icon for icon/button/input/avatar nodes.' },
	width: sizeValue('Width'),
	height: sizeValue('Height'),
	fill: colorValue('Background color (for toggle/checkbox: the "on" color; for icon: unused)'),
	textColor: colorValue('Text / icon color'),
	stroke: colorValue("Border color ('transparent' = none)"),
	strokeWidth: { type: 'number' },
	radius: { type: 'number', description: 'Corner radius in px.' },
	fontSize: { type: 'number' },
	fontWeight: { type: 'number', enum: [400, 500, 600, 700] },
	align: { type: 'string', enum: ['left', 'center', 'right'], description: 'Text alignment.' },
	shadow: { type: 'string', enum: ['none', 'sm', 'md', 'lg'] },
	opacity: { type: 'number', description: '0..1' },
	checked: { type: 'boolean', description: 'State of a toggle or checkbox.' },
	trailingIcon: { type: 'string', enum: ICONS, description: "Input only: icon at the end (eye on a password field)." },
	chart: { type: 'string', enum: ['bar', 'line'], description: 'Chart only: chart type.' },
	data: { type: 'array', items: { type: 'number' }, description: 'Chart only: 6-12 values.' },
	labels: { type: 'array', items: { type: 'string' }, description: 'Chart only: short x-axis labels, one per value.' },
	highlight: { type: 'integer', description: 'Chart only: index of the emphasized value (default: the peak).' },
	prefix: { type: 'string', description: "Chart only: value prefix, e.g. '$'." },
	suffix: { type: 'string', description: "Chart only: value suffix, e.g. '%'." },
	...layoutProps,
	x: { type: 'number', description: "Position relative to the parent. Only used when the parent's layout is 'none'." },
	y: { type: 'number' },
}

const NODE_TYPES = ['frame', 'text', 'button', 'input', 'image', 'icon', 'avatar', 'toggle', 'checkbox', 'divider', 'rect', 'badge', 'chart']

/** JSON schema of one UiNodeSpec (children are UiNodeSpecs too). */
const uiNodeSpec = {
	type: 'object',
	description:
		'A design node. Types: frame (auto-layout container), text, button, input, image (generated abstract art), icon (with fill = an icon tile), avatar, toggle, checkbox, divider, rect, badge (pill: status, delta, eyebrow), chart (bar/line with axes). A frame with template + items repeats the template once per item.',
	properties: {
		id: { type: 'string', description: "Unique semantic id, e.g. 'login_email'. Prefix with the screen id to keep ids unique across screens." },
		type: { type: 'string', enum: NODE_TYPES },
		...nodeProps,
		children: {
			type: 'array',
			description: 'Child nodes (frames only), each with the same shape as this node.',
			items: { type: 'object' },
		},
		template: { type: 'object', description: 'Frames: a node spec repeated once per entry of items; "{key}" in its strings is replaced by the entry\'s value (a field that is just "{key}" is dropped when the entry has no such key).' },
		items: { type: 'array', items: { type: 'object' }, description: 'Frames with a template: one object of values per repetition.' },
		dividers: { type: 'boolean', description: 'Frames with items: put a divider between the repeated rows.' },
	},
	required: ['id', 'type'],
}

export const DRAWING_TOOLS: ToolDef[] = [
	{
		name: 'create_screen',
		description:
			'Creates an app screen (artboard) together with its whole node tree in one call. Screens are vertical auto-layout stacks (padding 24, gap 16, stretch) unless overridden. Without x/y it is placed to the right of the existing screens. Calling it again with an existing screen id replaces that screen\'s contents (keeping its position). Returns the laid-out tree with sizes.',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string', description: "Semantic screen id, e.g. 'login'." },
				name: { type: 'string', description: "Screen title shown above it, e.g. 'Login'." },
				device: { type: 'string', enum: Object.keys(DEVICES), description: 'Size preset (default iphone 390x844).' },
				width: { type: 'number' },
				height: { type: 'number' },
				x: { type: 'number' },
				y: { type: 'number' },
				theme: { type: 'string', enum: ['light', 'dark'] },
				primary: { type: 'string', description: "Brand color '#rrggbb' for the $primary token." },
				fill: colorValue('Screen background (default $bg)'),
				tabs: { type: 'array', items: { type: 'object', properties: { icon: { type: 'string', enum: ICONS }, label: { type: 'string' } } }, description: 'Phone screens: a bottom tab bar (3-5 items). Content stays clear of it.' },
				activeTab: { type: 'integer', description: 'Index of the active tab.' },
				...layoutProps,
				children: { type: 'array', items: uiNodeSpec, description: 'Top-level nodes of the screen, top to bottom.' },
			},
			required: ['id', 'name'],
		},
	},
	{
		name: 'add_nodes',
		description: 'Inserts one or more node subtrees into a screen or frame, at the end or at a given index among its children. The screen is re-laid out.',
		parameters: {
			type: 'object',
			properties: {
				parentId: { type: 'string', description: 'Id of the screen or frame to insert into.' },
				index: { type: 'integer', description: 'Position among the existing children (0 = first). Default: append.' },
				nodes: { type: 'array', items: uiNodeSpec },
			},
			required: ['parentId', 'nodes'],
		},
	},
	{
		name: 'update_node',
		description:
			'Changes properties of an existing node or screen (text, colors, size, auto layout, ...). Only the given fields change; children are not replaced (use add_nodes / delete_nodes). Changing a node a user made asks them for permission first.',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				type: { type: 'string', enum: NODE_TYPES, description: 'Optional: turn the node into another type.' },
				...nodeProps,
				tabs: { type: 'array', items: { type: 'object' }, description: 'Screens: replace the tab bar items ({icon, label}); [] removes it.' },
				activeTab: { type: 'integer' },
			},
			required: ['id'],
		},
	},
	{
		name: 'move_node',
		description: 'Reorders a node among its siblings, or moves it into another screen/frame.',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				parentId: { type: 'string', description: 'New parent screen/frame (default: keep the current parent).' },
				index: { type: 'integer', description: 'New position among the parent\'s children (default: last).' },
			},
			required: ['id'],
		},
	},
	{
		name: 'delete_nodes',
		description: 'Deletes nodes (with their children) or whole screens. Deleting a user\'s nodes asks them for permission first.',
		parameters: {
			type: 'object',
			properties: { ids: { type: 'array', items: { type: 'string' } } },
			required: ['ids'],
		},
	},
	{
		name: 'duplicate_screen',
		description:
			"Copies a screen with all its nodes, placed to the right of the existing screens. Child ids get the new screen id as prefix (e.g. 'login_title' -> 'signup_title'); the result lists the id mapping.",
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'Screen to copy.' },
				newId: { type: 'string' },
				name: { type: 'string' },
			},
			required: ['id', 'newId'],
		},
	},
	{
		name: 'set_theme',
		description: "Switches a screen (or 'all' screens) between light and dark mode and/or changes its brand color. Every color token re-resolves, so nothing else needs editing.",
		parameters: {
			type: 'object',
			properties: {
				screenId: { type: 'string', description: "Screen id, or 'all'." },
				mode: { type: 'string', enum: ['light', 'dark'] },
				primary: { type: 'string', description: "Brand color '#rrggbb'." },
			},
			required: ['screenId'],
		},
	},
	{
		name: 'connect_screens',
		description: 'Draws a prototype flow arrow from a node (e.g. a button) or screen to another screen, like a Figma prototype connection.',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				fromId: { type: 'string', description: 'Node or screen the interaction starts from.' },
				toId: { type: 'string', description: 'Destination screen.' },
				label: { type: 'string', description: "Optional trigger label, e.g. 'On tap'." },
			},
			required: ['id', 'fromId', 'toId'],
		},
	},
	{
		name: 'focus_view',
		description:
			"Pan or zoom the canvas viewport to focus attention on specific screens or nodes. 'scope' controls whether everyone's view moves or only the requesting user's.",
		parameters: {
			type: 'object',
			properties: {
				shapeIds: { type: 'array', items: { type: 'string' } },
				zoomLevel: { type: 'number', default: 1.0 },
				scope: { type: 'string', enum: ['requester', 'everyone'], default: 'requester' },
			},
			required: ['shapeIds'],
		},
	},
	{
		name: 'clear_canvas',
		description:
			"Clears elements from the canvas. 'agent_only' removes only your own shapes. 'all' or 'selection' that would remove user-made shapes asks a user for confirmation first.",
		parameters: {
			type: 'object',
			properties: {
				mode: { type: 'string', enum: ['all', 'selection', 'agent_only'] },
				ids: { type: 'array', items: { type: 'string' } },
			},
			required: ['mode'],
		},
	},
]

export const READING_TOOLS: ToolDef[] = [
	{
		name: 'get_canvas_state',
		description:
			'Returns the design: every screen as a nested tree of nodes (id, type, name, text, w/h, colors, auto layout, author), plus any other shapes (sketches, notes, arrows) as a flat list. To stay compact, props equal to the kind defaults are omitted (e.g. a button without fill uses $primary; width/height sizing appears only when it differs from the default, "fixed" meaning w/h are fixed numbers), and x/y (relative to the parent) appear only where the parent has no auto layout. Pass shapeIds to get only those screens/nodes (with their subtrees).',
		parameters: {
			type: 'object',
			properties: {
				region,
				shapeIds: { type: 'array', items: { type: 'string' }, description: 'Optional explicit screens/nodes/shapes to return' },
				author: { type: 'string', enum: ['any', 'user', 'agent'], default: 'any' },
				audit: { type: 'boolean', description: 'Also return "audit": measured problems per screen (overflow, clipped text, contrast, touch targets, small text, unequal card heights). Critiques may only claim geometry/contrast problems listed there.' },
			},
		},
	},
	{
		name: 'get_canvas_image',
		description:
			'Renders the canvas (or a region / set of screens) to a PNG and shows it to you. Use it to judge visual quality, and for hand-drawn sketches or wireframes without structure.',
		parameters: {
			type: 'object',
			properties: {
				shapeIds: { type: 'array', items: { type: 'string' } },
				region,
				scale: { type: 'number', default: 1.0 },
			},
		},
	},
	{
		name: 'get_recent_changes',
		description:
			'Returns shapes created, updated, or deleted by users since you last looked (or since a given timestamp), grouped by user.',
		parameters: {
			type: 'object',
			properties: { since: { type: 'string', description: "ISO timestamp; defaults to the agent's last review" } },
		},
	},
	{
		name: 'get_participants',
		description: 'Lists connected users with name, color, cursor position, current selection, and whether they are actively editing.',
		parameters: { type: 'object', properties: {} },
	},
]

export const FEEDBACK_TOOLS: ToolDef[] = [
	{
		name: 'highlight_shapes',
		description:
			'Draws a colored outline around nodes or screens to point at them during a critique (red = problem, green = good). Non-destructive.',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				shapeIds: { type: 'array', items: { type: 'string' } },
				style: { type: 'string', enum: ['circle', 'outline', 'underline'], default: 'outline' },
				color: { type: 'string', enum: ['red', 'green', 'orange', 'blue'] },
			},
			required: ['id', 'shapeIds', 'color'],
		},
	},
	{
		name: 'add_comment',
		description: 'Pins a design-review comment (a small card beside the screen, with a leader line to the node) next to a node or screen.',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				targetShapeId: { type: 'string' },
				text: { type: 'string' },
				kind: { type: 'string', enum: ['issue', 'suggestion', 'praise', 'question'] },
				addressedTo: { type: 'string', description: 'Optional user name the comment is for' },
			},
			required: ['id', 'text', 'kind'],
		},
	},
]

export const ALL_TOOLS: ToolDef[] = [...DRAWING_TOOLS, ...READING_TOOLS, ...FEEDBACK_TOOLS]

/** Tools that run on the server (no browser editor needed). */
export const SERVER_TOOLS = new Set(['get_recent_changes'])

/** Live voice mode only: the realtime voice model can't take images, so it asks a vision model. */
export const LOOK_AT_BOARD: ToolDef = {
	name: 'look_at_board',
	description:
		"Takes a picture of the canvas (or of specific screens) and gets a description of what it looks like, including hand-drawn sketches. Use it before critiquing visual quality. Say a short line like 'Let me take a look' first.",
	parameters: {
		type: 'object',
		properties: {
			question: { type: 'string', description: 'What you want to know about the design' },
			shapeIds: { type: 'array', items: { type: 'string' } },
		},
	},
}

/** Tools for live voice mode (run in the browser; no server-side tools). */
export const REALTIME_TOOLS: ToolDef[] = [
	...DRAWING_TOOLS,
	...READING_TOOLS.filter((t) => t.name === 'get_canvas_state' || t.name === 'get_participants'),
	LOOK_AT_BOARD,
	...FEEDBACK_TOOLS,
]
