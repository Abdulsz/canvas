// Tool (function) definitions given to Grok. Kept in one place so the server
// (which sends them to the model) and the client (which executes them on the
// tldraw editor) agree on names and argument shapes.

export type ToolDef = {
	name: string
	description: string
	parameters: Record<string, unknown>
}

const color = { type: 'string', enum: ['black', 'blue', 'green', 'red', 'orange', 'grey'] }
const region = {
	type: 'object',
	description: 'Page-space bounding box',
	properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
}

const createShapeParams = {
	type: 'object',
	properties: {
		id: { type: 'string', description: "Unique semantic shape ID (e.g., 'db_main', 'node_root')" },
		type: { type: 'string', enum: ['geo', 'text', 'note'] },
		geo: {
			type: 'string',
			enum: ['rectangle', 'ellipse', 'diamond'],
			description: 'Shape geometry if type is geo',
		},
		x: { type: 'number', description: 'Canvas X position' },
		y: { type: 'number', description: 'Canvas Y position' },
		w: { type: 'number', description: 'Width' },
		h: { type: 'number', description: 'Height' },
		label: { type: 'string', description: 'Text content inside or on the shape' },
		color,
	},
	required: ['id', 'type', 'x', 'y', 'label'],
}

const createArrowParams = {
	type: 'object',
	properties: {
		id: { type: 'string' },
		fromId: { type: 'string', description: 'Start shape ID' },
		toId: { type: 'string', description: 'Target shape ID' },
		label: { type: 'string', description: "Optional connection label (e.g., 'gRPC', 'HTTP')" },
		color,
	},
	required: ['id', 'fromId', 'toId'],
}

export const DRAWING_TOOLS: ToolDef[] = [
	{
		name: 'create_shape',
		description:
			'Creates a visual element on the whiteboard canvas (boxes, circles, text, sticky notes). Calling it again with an existing agent-authored id updates that shape. If the position overlaps a student\'s drawing it is nudged to free space; the result reports the final position.',
		parameters: createShapeParams,
	},
	{
		name: 'create_arrow',
		description: 'Draws a directed connection arrow between two shapes.',
		parameters: createArrowParams,
	},
	{
		name: 'draw_array',
		description:
			'Renders an array data structure with indices and pointer markers. Call again with the same id to redraw it (e.g., to move pointers on the next algorithm iteration).',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				startX: { type: 'number' },
				startY: { type: 'number' },
				values: { type: 'array', items: { type: 'string' }, description: 'Array elements' },
				pointers: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							index: { type: 'integer' },
							label: { type: 'string', description: "e.g. 'left', 'right', 'mid'" },
						},
					},
				},
				highlight: {
					type: 'array',
					items: { type: 'integer' },
					description: 'Optional indices to highlight in the current step',
				},
			},
			required: ['id', 'startX', 'startY', 'values'],
		},
	},
	{
		name: 'update_shape',
		description:
			'Modifies an existing shape (move, relabel, recolor). Intended for agent-authored shapes. Changing a student-authored shape asks a student for permission first.',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				x: { type: 'number' },
				y: { type: 'number' },
				label: { type: 'string' },
				color,
			},
			required: ['id'],
		},
	},
	{
		name: 'focus_view',
		description:
			"Pan or zoom the canvas viewport to focus attention on specific shapes. 'scope' controls whether everyone's view moves or only the requesting user's.",
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
			"Clears elements from the whiteboard. 'agent_only' removes only your own shapes. 'all' or 'selection' that would remove student-authored shapes asks a student for confirmation first.",
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
			'Returns a structured description of shapes on the canvas: id, type, bounds, label/text, color, arrow connections (fromId/toId), and author. Use this to understand diagrams and arrays students have drawn.',
		parameters: {
			type: 'object',
			properties: {
				region,
				shapeIds: { type: 'array', items: { type: 'string' }, description: 'Optional explicit shapes to return' },
				author: { type: 'string', enum: ['any', 'user', 'agent'], default: 'any' },
			},
		},
	},
	{
		name: 'get_canvas_image',
		description:
			'Renders the canvas (or a region / set of shapes) to a PNG and shows it to you. Required for freehand drawings, handwriting, and sketches without labels.',
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
			'Returns shapes created, updated, or deleted by students since you last looked (or since a given timestamp), grouped by student.',
		parameters: {
			type: 'object',
			properties: { since: { type: 'string', description: "ISO timestamp; defaults to the agent's last review" } },
		},
	},
	{
		name: 'get_participants',
		description:
			'Lists connected students with name, color, cursor position, current selection, and whether they are actively drawing.',
		parameters: { type: 'object', properties: {} },
	},
]

export const FEEDBACK_TOOLS: ToolDef[] = [
	{
		name: 'highlight_shapes',
		description:
			'Draws a colored outline / circle around shapes to point at them (red for an error, green for correct). Non-destructive.',
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
		description:
			'Places a callout sticky note next to a shape with feedback text, connected by a short leader arrow.',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				targetShapeId: { type: 'string' },
				text: { type: 'string' },
				kind: { type: 'string', enum: ['error', 'hint', 'praise', 'question'] },
				addressedTo: { type: 'string', description: 'Optional student name the comment is for' },
			},
			required: ['id', 'text', 'kind'],
		},
	},
	{
		name: 'suggest_correction',
		description:
			"Draws a proposed fix as a dashed, semi-transparent overlay next to the student's work without modifying it. Students can accept or dismiss it. Each entry in 'shapes' uses the create_shape argument format, or the create_arrow format (entries with fromId/toId).",
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				forShapeIds: { type: 'array', items: { type: 'string' } },
				shapes: { type: 'array', items: { type: 'object' } },
				explanation: { type: 'string' },
			},
			required: ['id', 'shapes'],
		},
	},
]

export const ALL_TOOLS: ToolDef[] = [...DRAWING_TOOLS, ...READING_TOOLS, ...FEEDBACK_TOOLS]

/** Tools that run on the server (no browser editor needed). */
export const SERVER_TOOLS = new Set(['get_recent_changes'])
