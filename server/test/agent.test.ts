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
const agentAuthor = { kind: 'agent', id: 'agent', name: 'Professor Grok' }
function putShape(room: Room, id: string, author: object) {
	room.shapes.set(`shape:${id}`, { id: `shape:${id}`, typeName: 'shape', type: 'geo', x: 0, y: 0, parentId: 'page:page', props: {}, meta: { author } })
}

test('guard asks before touching student work, never for agent shapes', () => {
	const room = new Room('t1', null)
	const agent = new AgentSession(room, new MockProvider())
	putShape(room, 'student_box', user('Bob'))
	putShape(room, 'agent_box', agentAuthor)

	assert.match(agent.guard('update_shape', { id: 'student_box' })!.message, /drawn by Bob/)
	assert.match(agent.guard('create_shape', { id: 'student_box' })!.message, /Bob/)
	assert.equal(agent.guard('update_shape', { id: 'agent_box' }), undefined)
	assert.equal(agent.guard('clear_canvas', { mode: 'agent_only' }), undefined)
	assert.match(agent.guard('clear_canvas', { mode: 'all' })!.message, /erase 1 shape/)
	assert.equal(agent.guard('clear_canvas', { mode: 'selection', ids: ['agent_box'] }), undefined)
	assert.equal(agent.guard('highlight_shapes', { id: 'h', shapeIds: ['student_box'] }), undefined)
})

test('check my work: reads the board (with an image for freehand ink) and annotates', async () => {
	const room = new Room('t2', null)
	const agent = new AgentSession(room, new MockProvider())
	const boardState = {
		count: 2,
		shapes: [
			{ id: 'cache', type: 'geo', label: 'Redis Cache', author: { kind: 'user', name: 'Bob' } },
			{ id: 'ink', type: 'draw', author: { kind: 'user', name: 'Bob' } },
		],
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
	const comment = bob.toolCalls().find((c) => c.name === 'add_comment')
	assert.equal(comment.args.targetShapeId, 'cache')
	assert.equal(comment.args.addressedTo, 'Bob')
	assert.match(comment.args.text, /Redis Cache/)
	assert.ok(bob.received.some((m) => m.type === 'agent_say' && /Bob, nice work/.test(m.text)))
	assert.ok(bob.toolCalls().every((c) => !c.confirm), 'annotations never need confirmation')
})

test('tool calls go to the requesting student; speech is broadcast to everyone', async () => {
	const room = new Room('t3', null)
	const agent = new AgentSession(room, new MockProvider())
	const ok = () => ({ ok: true, data: {} })
	const alice = new FakeClient(ok)
	const bob = new FakeClient(ok)
	agent.addClient(alice as any)
	agent.addClient(bob as any)
	alice.push({ type: 'hello', userId: 'alice', name: 'Alice', color: '#f00' })
	bob.push({ type: 'hello', userId: 'bob', name: 'Bob', color: '#00f' })
	bob.push({ type: 'user_message', text: 'explain a web architecture', selection: [] })
	await bob.waitIdle()

	assert.ok(bob.toolCalls().length >= 10)
	assert.equal(alice.toolCalls().length, 0)
	const aliceSays = alice.received.filter((m) => m.type === 'agent_say')
	assert.ok(aliceSays.length >= 3 && aliceSays.every((m) => m.report === false))
	// focus_view with scope "everyone" moves the other students' views too.
	assert.ok(alice.received.some((m) => m.type === 'focus'))
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
