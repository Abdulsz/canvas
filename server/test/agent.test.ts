import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { AgentSession } from '../src/agent.ts'
import { MockProvider } from '../src/mock.ts'
import { Room } from '../src/rooms.ts'

/** Minimal stand-in for a browser tab connected to /agent/:roomId. */
class FakeClient extends EventEmitter {
	readonly OPEN = 1
	readyState = 1
	received: any[] = []
	constructor(private respond: (name: string, args: any) => any) {
		super()
	}
	send(raw: string) {
		const msg = JSON.parse(raw)
		this.received.push(msg)
		if (msg.type === 'tool_call') {
			const result = this.respond(msg.name, msg.args)
			setImmediate(() => this.push({ type: 'tool_result', callId: msg.callId, result }))
		}
		if (msg.type === 'agent_say' && msg.report) setImmediate(() => this.push({ type: 'speech_done', sayId: msg.sayId }))
	}
	push(msg: object) {
		this.emit('message', Buffer.from(JSON.stringify(msg)))
	}
	toolCalls() {
		return this.received.filter((m) => m.type === 'tool_call')
	}
	waitIdle() {
		return new Promise<void>((resolve) => {
			let wasBusy = false
			const check = setInterval(() => {
				const states = this.received.filter((m) => m.type === 'room_state')
				if (states.some((s) => s.busy)) wasBusy = true
				if (wasBusy && states.at(-1)?.busy === false) {
					clearInterval(check)
					resolve()
				}
			}, 5)
		})
	}
}

const user = (name: string) => ({ kind: 'user', id: name.toLowerCase(), name })
const agentAuthor = { kind: 'agent', id: 'agent', name: 'Grok Design' }
function putShape(room: Room, id: string, author: object) {
	room.shapes.set(`shape:${id}`, { id: `shape:${id}`, typeName: 'shape', type: 'geo', x: 0, y: 0, parentId: 'page:page', props: {}, meta: { author } })
}

test('guard asks before touching user work, never for agent shapes', () => {
	const room = new Room('t1', null)
	const agent = new AgentSession(room, new MockProvider())
	putShape(room, 'student_box', user('Bob'))
	putShape(room, 'agent_box', agentAuthor)

	assert.match(agent.guard('update_node', { id: 'student_box' })!.message, /designed by Bob/)
	assert.match(agent.guard('create_screen', { id: 'student_box' })!.message, /Bob/)
	assert.match(agent.guard('delete_nodes', { ids: ['student_box'] })!.message, /delete 1 element/)
	assert.match(agent.guard('add_nodes', { parentId: 'student_box', nodes: [] })!.message, /Bob/)
	assert.equal(agent.guard('update_node', { id: 'agent_box' }), undefined)
	assert.equal(agent.guard('set_theme', { screenId: 'all', mode: 'dark' }), undefined)
	assert.equal(agent.guard('clear_canvas', { mode: 'agent_only' }), undefined)
	assert.match(agent.guard('clear_canvas', { mode: 'all' })!.message, /erase 1 element/)
	assert.equal(agent.guard('clear_canvas', { mode: 'selection', ids: ['agent_box'] }), undefined)
	assert.equal(agent.guard('highlight_shapes', { id: 'h', shapeIds: ['student_box'] }), undefined)
})

const tree = (author: object) => ({
	id: 'mine',
	type: 'screen',
	name: 'Mine',
	author,
	children: [
		{ id: 'mine_title', type: 'text', text: 'Pricing', fontSize: 28 },
		{ id: 'mine_small_btn', type: 'button', text: 'Buy', h: 32 },
	],
})

test('critique: reads the canvas (with an image for freehand ink) and annotates', async () => {
	const room = new Room('t2', null)
	const agent = new AgentSession(room, new MockProvider())
	const boardState = {
		count: 2,
		shapes: [tree({ kind: 'user', name: 'Bob' }), { id: 'ink', type: 'draw', author: { kind: 'user', name: 'Bob' } }],
	}
	const bob = new FakeClient((name) => {
		if (name === 'get_canvas_state') return { ok: true, data: boardState }
		if (name === 'get_canvas_image') return { ok: true, image: 'data:image/png;base64,AAAA', data: {} }
		return { ok: true, data: {} }
	})
	agent.addClient(bob as any)
	bob.push({ type: 'hello', userId: 'bob', name: 'Bob', color: '#00f' })
	bob.push({ type: 'check_work', shapeIds: [] })
	await bob.waitIdle()

	const names = bob.toolCalls().map((c) => c.name)
	assert.deepEqual(names.slice(0, 2), ['get_canvas_state', 'get_canvas_image'], 'context gathered before the model runs')
	assert.ok(names.includes('highlight_shapes'))
	const comments = bob.toolCalls().filter((c) => c.name === 'add_comment')
	assert.deepEqual(comments.map((c) => c.args.kind), ['praise', 'issue'])
	assert.equal(comments[0].args.targetShapeId, 'mine_title')
	assert.equal(comments[1].args.targetShapeId, 'mine_small_btn')
	assert.equal(comments[1].args.addressedTo, 'Bob')
	assert.match(comments[0].args.text, /Pricing/)
	assert.ok(bob.received.some((m) => m.type === 'agent_say' && /Bob, nice work/.test(m.text)))
	assert.ok(bob.toolCalls().every((c) => !c.confirm), 'annotations never need confirmation')
})

/** Runs one spoken request through the mock against a canvas that answers get_canvas_state with `shapes`. */
async function say(text: string, shapes: object[] = []) {
	const room = new Room('t_say', null)
	const agent = new AgentSession(room, new MockProvider())
	const bob = new FakeClient((name) => (name === 'get_canvas_state' ? { ok: true, data: { shapes } } : { ok: true, data: {} }))
	agent.addClient(bob as any)
	bob.push({ type: 'hello', userId: 'bob', name: 'Bob', color: '#00f' })
	bob.push({ type: 'user_message', text, selection: [] })
	await bob.waitIdle()
	return bob
}

const loginTree = {
	id: 'login',
	type: 'screen',
	name: 'Login',
	children: [
		{
			id: 'login_content',
			type: 'frame',
			children: [
				{ id: 'login_title', type: 'text', text: 'Welcome back' },
				{ id: 'login_primary_btn', type: 'button', text: 'Log in' },
			],
		},
	],
}

test('mock builds a login screen and ends with a steering question', async () => {
	const bob = await say('design a login screen')
	const create = bob.toolCalls().find((c) => c.name === 'create_screen')
	assert.equal(create.args.id, 'login')
	assert.equal(create.args.device, 'iphone')
	assert.ok(bob.toolCalls().some((c) => c.name === 'add_nodes'))
	const says = bob.received.filter((m) => m.type === 'agent_say' && !m.ephemeral)
	assert.ok(says.length >= 3)
	assert.match(says.at(-1).text, /\?$/, 'last line is a question')
})

test('mock switches to dark mode with set_theme', async () => {
	const bob = await say('switch to dark mode')
	const theme = bob.toolCalls().find((c) => c.name === 'set_theme')
	assert.deepEqual(theme.args, { screenId: 'all', mode: 'dark' })
})

test('mock recolors the primary button with update_node', async () => {
	const bob = await say('make the button green', [loginTree])
	const names = bob.toolCalls().map((c) => c.name)
	assert.deepEqual(names, ['get_canvas_state', 'update_node'])
	assert.deepEqual(bob.toolCalls()[1].args, { id: 'login_primary_btn', fill: '#16a34a' })
})

test('mock edits text, adds components, deletes, and connects a new screen', async () => {
	let bob = await say('change the title to Hello again', [loginTree])
	assert.deepEqual(bob.toolCalls()[1].args, { id: 'login_title', text: 'Hello again' })
	bob = await say('add an input', [loginTree])
	assert.equal(bob.toolCalls()[1].name, 'add_nodes')
	assert.equal(bob.toolCalls()[1].args.parentId, 'login_content')
	bob = await say('delete the button', [loginTree])
	assert.deepEqual(bob.toolCalls()[1].args, { ids: ['login_primary_btn'] })
	bob = await say('add a signup screen and connect it', [loginTree])
	assert.deepEqual(bob.toolCalls().map((c) => c.name).slice(1, 3), ['create_screen', 'connect_screens'])
	assert.equal(bob.toolCalls()[2].args.toId, 'signup')
})

test('tool calls go to the requesting collaborator; speech is broadcast to everyone', async () => {
	const room = new Room('t3', null)
	const agent = new AgentSession(room, new MockProvider())
	const ok = () => ({ ok: true, data: {} })
	const alice = new FakeClient(ok)
	const bob = new FakeClient(ok)
	agent.addClient(alice as any)
	agent.addClient(bob as any)
	alice.push({ type: 'hello', userId: 'alice', name: 'Alice', color: '#f00' })
	bob.push({ type: 'hello', userId: 'bob', name: 'Bob', color: '#00f' })
	bob.push({ type: 'user_message', text: 'design a login screen', selection: [] })
	await bob.waitIdle()

	assert.ok(bob.toolCalls().length >= 2)
	assert.equal(alice.toolCalls().length, 0)
	const aliceSays = alice.received.filter((m) => m.type === 'agent_say')
	assert.ok(aliceSays.length >= 2 && aliceSays.every((m) => m.report === false))
	const history: any[] = (agent as any).history
	assert.ok(history.every((m) => m.role !== 'assistant' || typeof m.content === 'string'), 'no null assistant content in history')
})

test('change log reports student edits grouped by student, collapsing drags', () => {
	const room = new Room('t4', null)
	const agent = new AgentSession(room, new MockProvider())
	const shape = (x: number, author: object) => ({ id: 'shape:a', typeName: 'shape', type: 'geo', x, y: 0, parentId: 'page:page', props: { richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'API' }] }] } }, meta: { author, updatedBy: author } })
	;(room as any).applyDiff({ puts: { 'shape:a': shape(0, user('Ann')) }, deletes: [] })
	;(room as any).applyDiff({ puts: { 'shape:a': [shape(0, user('Ann')), shape(50, user('Ann'))] }, deletes: [] })
	;(room as any).applyDiff({ puts: { 'shape:b': { ...shape(0, agentAuthor), id: 'shape:b' } }, deletes: [] })
	const changes = (agent as any).takeRecentChanges()
	assert.equal(changes.total, 1)
	assert.deepEqual(changes.byUser.Ann, [{ op: 'created', shape: { id: 'a', type: 'geo', label: 'API', x: 50, y: 0 } }])
	assert.equal((agent as any).takeRecentChanges().total, 0, 'reading the log advances the cursor')
})

test('stream assembler: speaks before tools, emits each tool call once it is complete', async () => {
	const { StreamAssembler } = await import('../src/llm.ts')
	const events: string[] = []
	const a = new StreamAssembler({ onText: (t) => events.push(`text:${t}`), onToolCall: (c) => events.push(`tool:${c.function.name}:${c.function.arguments}`) })
	a.push({ content: 'Here is ' })
	a.push({ content: 'a box.' })
	// OpenAI-style: one call split across deltas.
	a.push({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'create_screen', arguments: '{"id":' } }] })
	assert.deepEqual(events, [])
	a.push({ tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] })
	assert.deepEqual(events, ['text:Here is a box.', 'tool:create_screen:{"id":"a"}'])
	// xAI-style: a whole call in one delta.
	a.push({ tool_calls: [{ index: 1, id: 'c2', function: { name: 'connect_screens', arguments: '{"id":"x"}' } }] })
	const done = a.finish()
	assert.equal(events.length, 3)
	assert.deepEqual(done.toolCalls.map((c) => c.id), ['c1', 'c2'])
	assert.equal(done.text, 'Here is a box.')
})

test('silent design steps get a short narration from what was built', async () => {
	const { narrateDrawing } = await import('../src/agent.ts')
	const call = (name: string, args: object) => ({ id: name, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
	assert.equal(narrateDrawing([call('create_screen', { name: 'Login' })]), "Here's the Login screen.")
	assert.equal(narrateDrawing([call('create_screen', { name: 'Login' }), call('create_screen', { name: 'Sign up' })]), "Here's the Login screen and the Sign up screen.")
	assert.equal(narrateDrawing([call('update_node', { id: 'x' }), call('highlight_shapes', {})]), null)
})

test('critique focuses on the node the requester just edited and addresses them', async () => {
	const room = new Room('t_crit_edit', null)
	const agent = new AgentSession(room, new MockProvider())
	// Bob retitled an agent-made node in the Design panel (updatedBy Bob, author agent).
	;(room as any).changeLog.push({ op: 'updated', at: Date.now(), author: user('Bob'), shape: { id: 'login_title', type: 'ui', kind: 'text', label: 'Hi there', x: 0, y: 0 } })
	// get_canvas_state returns screens plus other shapes (a flow arrow), like the real executor.
	const state = { screens: [loginTree], shapes: [{ id: 'flow_1', type: 'arrow', role: 'flow' }] }
	const bob = new FakeClient((name) => (name === 'get_canvas_state' ? { ok: true, data: state } : { ok: true, data: {} }))
	agent.addClient(bob as any)
	bob.push({ type: 'hello', userId: 'bob', name: 'Bob', color: '#00f' })
	bob.push({ type: 'check_work', shapeIds: [] })
	await bob.waitIdle()
	const comments = bob.toolCalls().filter((c) => c.name === 'add_comment')
	assert.equal(comments[0].args.targetShapeId, 'login_title')
	assert.equal(comments[0].args.addressedTo, 'Bob')
	assert.ok(bob.received.some((m) => m.type === 'agent_say' && /^Bob, nice touch/.test(m.text)))
})

test('mock finds a node to delete on any screen; a declined change is acknowledged', async () => {
	const signupTree = { id: 'signup', type: 'screen', name: 'Sign up', children: [{ id: 'signup_title', type: 'text', text: 'Create your account' }] }
	const room = new Room('t_del', null)
	const agent = new AgentSession(room, new MockProvider())
	const bob = new FakeClient((name) =>
		name === 'get_canvas_state' ? { ok: true, data: { screens: [loginTree, signupTree] } } : name === 'delete_nodes' ? { ok: false, error: 'The user declined this change.' } : { ok: true, data: {} }
	)
	agent.addClient(bob as any)
	bob.push({ type: 'hello', userId: 'bob', name: 'Bob', color: '#00f' })
	bob.push({ type: 'user_message', text: 'delete the welcome back text', selection: [] })
	await bob.waitIdle()
	assert.deepEqual(bob.toolCalls()[1].args, { ids: ['login_title'] })
	const says = bob.received.filter((m) => m.type === 'agent_say' && !m.ephemeral)
	assert.ok(says.some((m) => /left that as it is/.test(m.text)))
})
