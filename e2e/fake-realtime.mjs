// A local stand-in for xAI's realtime speech-to-speech WebSocket, following the
// documented protocol (https://docs.x.ai/developers/rest-api-reference/inference/voice#realtime).
// Used to test the browser client end to end where wss://api.x.ai can't be reached.
//
// Script: the student speaks -> response 1 draws a diagram (3 function calls) ->
// response 2 calls look_at_board -> response 3 is a long answer that the
// "student" interrupts (server VAD speech_started), which the client must
// handle by stopping playback and sending conversation.item.truncate.
import { WebSocketServer } from 'ws'

const RATE = 24000

function tone(seconds, freq = 220) {
	const n = Math.round(RATE * seconds)
	const pcm = new Int16Array(n)
	for (let i = 0; i < n; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / RATE) * 0.2 * 0x7fff)
	return Buffer.from(pcm.buffer)
}

export function startFakeRealtime({ port = 8790, token = 'local-test-token' } = {}) {
	const log = { events: [], outputs: [], truncate: null, session: null, appendedBytes: 0, timings: {}, protocolOk: false }
	const wss = new WebSocketServer({
		port,
		handleProtocols: (protocols) => {
			const expected = `xai-client-secret.${token}`
			log.protocolOk = protocols.has(expected)
			return log.protocolOk ? expected : false
		},
	})
	wss.on('connection', (ws) => {
		const t0 = Date.now()
		const send = (ev) => ws.send(JSON.stringify({ event_id: `evt_${Math.random().toString(36).slice(2)}`, ...ev }))
		let step = 0
		let speaking = false
		let voicedMs = 0
		let silentMs = 0
		let heard = false
		let awaitingOutputs = 0
		send({ type: 'session.created', session: { id: 'sess_fake', object: 'realtime.session' } })
		send({ type: 'conversation.created', conversation: { id: 'conv_fake' } })

		const respond = (n) => {
			const id = `resp_${n}`
			const item = `item_${n}`
			const script = {
				1: { say: 'A load balancer spreads requests across servers. Let me draw it.', seconds: 1.5, calls: [
					['create_shape', { id: 'client', type: 'geo', geo: 'ellipse', x: 0, y: 0, w: 160, h: 80, label: 'Client' }],
					['create_shape', { id: 'lb', type: 'geo', x: 260, y: 0, w: 160, h: 80, label: 'Load Balancer', color: 'blue' }],
					['create_arrow', { id: 'a1', fromId: 'client', toId: 'lb', label: 'HTTPS' }],
				] },
				2: { say: 'Let me take a look at the board.', seconds: 1.0, calls: [['look_at_board', { question: 'What is drawn on the board?' }]] },
				3: { say: 'Here is a much longer explanation that keeps going for a while so the student can interrupt me.', seconds: 6.0, calls: [], interrupt: true },
			}[n]
			if (!script) return
			log.timings[`response${n}`] = Date.now() - t0
			send({ type: 'response.created', response: { id, object: 'realtime.response', status: 'in_progress', output: [] } })
			send({ type: 'response.output_item.added', response_id: id, item: { id: item, type: 'message', role: 'assistant' } })
			const audio = tone(script.seconds)
			const chunk = (RATE / 10) * 2
			for (let o = 0; o < audio.length; o += chunk) {
				send({ type: 'response.output_audio.delta', response_id: id, item_id: item, output_index: 0, content_index: 0, delta: audio.subarray(o, o + chunk).toString('base64') })
			}
			send({ type: 'response.output_audio_transcript.delta', response_id: id, item_id: item, delta: script.say })
			send({ type: 'response.output_audio.done', response_id: id, item_id: item })
			send({ type: 'response.output_audio_transcript.done', response_id: id, item_id: item, transcript: script.say })
			script.calls.forEach(([name, args], i) =>
				send({ type: 'response.function_call_arguments.done', response_id: id, item_id: `fc_${n}_${i}`, call_id: `call_${n}_${i}`, name, arguments: JSON.stringify(args) })
			)
			awaitingOutputs = script.calls.length
			log.timings[`response${n}AudioSeconds`] = script.seconds
			if (script.interrupt) {
				// Simulate the student talking over the long answer.
				setTimeout(() => {
					send({ type: 'input_audio_buffer.speech_started', item_id: 'user_item_2', audio_start_ms: 0 })
					log.timings.interruptAt = Date.now() - t0
					send({ type: 'response.done', response: { id, object: 'realtime.response', status: 'cancelled' } })
				}, 2000)
			} else {
				send({ type: 'response.done', response: { id, object: 'realtime.response', status: 'completed' } })
				log.timings[`response${n}Done`] = Date.now() - t0
			}
		}

		ws.on('message', (raw) => {
			const ev = JSON.parse(raw.toString())
			log.events.push({ type: ev.type, at: Date.now() - t0 })
			switch (ev.type) {
				case 'session.update':
					log.session = ev.session
					send({ type: 'session.updated', session: ev.session })
					break
				case 'input_audio_buffer.append': {
					// Simple server-side VAD over the student's PCM16 audio.
					const pcm = new Int16Array(Buffer.from(ev.audio, 'base64').buffer.slice(0))
					log.appendedBytes += pcm.length * 2
					let sum = 0
					for (const v of pcm) sum += (v / 32768) ** 2
					const rms = Math.sqrt(sum / Math.max(1, pcm.length))
					const ms = (pcm.length / RATE) * 1000
					if (heard) break
					if (rms > 0.01) {
						voicedMs += ms
						silentMs = 0
						if (!speaking && voicedMs > 200) {
							speaking = true
							send({ type: 'input_audio_buffer.speech_started', item_id: 'user_item_1', audio_start_ms: 0 })
						}
					} else if (speaking) {
						silentMs += ms
						if (silentMs > 700) {
							heard = true
							send({ type: 'input_audio_buffer.speech_stopped', item_id: 'user_item_1' })
							send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'user_item_1', transcript: 'Hey professor, can you explain how a load balancer works?' })
							log.timings.heard = Date.now() - t0
							respond(++step)
						}
					}
					break
				}
				case 'conversation.item.create':
					if (ev.item?.type === 'function_call_output') {
						log.outputs.push({ call_id: ev.item.call_id, output: JSON.parse(ev.item.output), at: Date.now() - t0 })
						awaitingOutputs--
					}
					break
				case 'response.create':
					log.timings[`create${step + 1}`] = Date.now() - t0
					log.timings[`outputsPendingAtCreate${step + 1}`] = awaitingOutputs
					respond(++step)
					break
				case 'conversation.item.truncate':
					log.truncate = { ...ev, at: Date.now() - t0 }
					break
			}
		})
	})
	return { log, close: () => wss.close() }
}
