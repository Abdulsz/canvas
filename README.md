# Grok Whiteboard

A shared, voice-driven teaching whiteboard. Professor Grok (an xAI Grok agent) explains system design, algorithms and other technical topics while drawing on a [tldraw](https://tldraw.dev) canvas. Several students can join the same board, draw alongside the agent, and ask it to check their work. The agent reads the board (shape data, plus an image when there's freehand ink) and answers by voice and with notes on the canvas.

See [`interactive_whiteboard_agent_spec.md`](interactive_whiteboard_agent_spec.md) for the full spec.

## Quick start

```bash
npm install
cp .env.example .env          # optional: add XAI_API_KEY
npm run dev                   # server on :8787, client on :5173
```

Open http://localhost:5173. You'll be sent to a new room (`/r/<id>`). Use **Invite** to copy the link and open it in another browser to collaborate.

If `XAI_API_KEY` isn't set, the server uses a **scripted mock agent** so you can try every flow offline:

- Ask "explain a web architecture" and it draws a load-balanced web app.
- Ask "show two pointers on an array" and it walks through a two-pointer search step by step.
- Draw something, then press **Check my work**. It reads your shapes, highlights them and leaves a comment addressed to you.

Production build: `npm run build && npm start` (the server serves `client/dist` on :8787).

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `XAI_API_KEY` | (none, uses the mock agent) | xAI API key |
| `XAI_MODEL` | `grok-4.7` | xAI chat model with tool calling and image input. `grok-4.7` was the fastest model tested that both speaks and draws in each step |
| `XAI_OPENER_MODEL` | `grok-4.20-non-reasoning` | Fast model that speaks the first sentence or two while the drawing model works (`off` disables) |
| `XAI_REASONING_EFFORT` | `low` | Reasoning effort for conversational turns (`XAI_REVIEW_REASONING_EFFORT`, default `medium`, for reviews) |
| `XAI_VOICE` | `ara` | Grok voice for the agent (`GET https://api.x.ai/v1/tts/voices` lists them) |
| `XAI_REALTIME_MODEL` | `grok-voice-latest` | Speech-to-speech model for Live voice |
| `REALTIME` | `on` | `off` hides the Live voice option |
| `VOICE` | `grok` | `browser` forces the Web Speech API fallback even when an API key is set |
| `XAI_BASE_URL` | `https://api.x.ai/v1` | OpenAI-compatible endpoint |
| `PORT` | `8787` | Server port |
| `DATA_DIR` | `server/data` | Room databases (SQLite) and uploaded images |
| `PERSIST` | `true` | `false` keeps rooms in memory only |
| `IDLE_MS` | `4000` | Proactive mode: how long students must pause before the agent looks |
| `VITE_TLDRAW_LICENSE_KEY` | (none) | tldraw license key, needed for production deployments |

The server reads `.env` from the repo root on start.

## How it works

```
 Browser (student A)            Browser (student B)
 ┌───────────────────┐          ┌───────────────────┐
 │ tldraw + useSync  │◄────────►│ tldraw + useSync  │   /sync/:room   (tldraw sync protocol)
 │ Agent panel/voice │          │ Agent panel/voice │   /agent/:room  (agent protocol, shared/protocol.ts)
 └─────────┬─────────┘          └─────────┬─────────┘
           └──────────────┬───────────────┘
                 Node server (server/src)
   rooms.ts   TLSocketRoom per room (SQLite), shape mirror, change log
   agent.ts   AgentSession per room: Grok tool loop, guard, review triggers
   llm.ts     xAI chat-completions client (mock.ts = offline stand-in)
```

- **Sync and presence.** `@tldraw/sync` keeps one authoritative document per room, with live cursors and names. Rooms are stored in SQLite under `DATA_DIR/rooms`.
- **Authorship.** Each tab stamps `meta.author` / `meta.updatedBy` (`{ kind: 'user' | 'agent', id, name }`) on the shapes it creates or edits (`client/src/agent/authorship.ts`).
- **Agent as a participant.** The server runs the Grok loop. Drawing tools are carried out by a connected browser (the student who triggered the turn) through `CanvasExecutor` (`client/src/agent/executor.ts`). The edits then sync to everyone like any other edit. The agent has its own cursor, which is broadcast to the room.
- **Seeing the board.** `get_canvas_state` returns shapes, labels, arrow connections and authors. `get_canvas_image` returns a PNG (`editor.toImage`) that is sent to Grok as an image input. `get_recent_changes` is served from the server's change log. For **Check my work** and proactive reviews, the server gathers this context up front. It always includes an image when the student drew freehand ink.
- **Review modes.** *On request* (button or voice), *Proactive* (runs after students pause for `IDLE_MS`) and *Exercise* (the agent sets a task, then grades it).
- **Respecting student work.** `AgentSession.guard` checks every tool call against the server's copy of the shapes. Any call that would change or erase a student-authored shape needs a student to click **Allow** first. Annotations (`highlight_shapes`, `add_comment`, `suggest_correction`) never touch student shapes. Students can **Accept** or **Dismiss** suggested corrections from the panel.
- **Voice conversation.** Tap the mic once and just talk; the mic stays open (hands-free).
  - *Listening:* the browser records with echo cancellation and detects when you start and stop talking. Each utterance goes to Grok speech-to-text through `POST /api/stt`.
  - *Thinking and drawing:* the agent streams Grok's reply. It starts speaking as soon as the step's sentence is complete, and runs each drawing call the moment it arrives.
  - *Speaking:* the server starts Grok text-to-speech right away and streams the audio to everyone in the room from one request (`GET /api/tts/:id`).
  - *No dead air:* the moment you finish talking, a short pre-synthesized acknowledgement plays ("Sure."). A fast non-reasoning model then speaks the first sentence or two, about 1s later, while `grok-4.7` (at low reasoning effort) prepares the drawing. It's told what was already said, so it continues without repeating. Each sentence goes to the voice as soon as it streams in.
  - *Pacing:* each step is one short spoken line plus that step's drawing. The next step waits for the line to finish, so the drawing stays in step with the voice.
  - *Interrupting:* talking over the agent cuts its voice off immediately, and your question takes over the turn.
  - *Fallback:* without an API key, the browser's Web Speech API is used instead (`client/src/agent/speech.ts`).

### Live voice (beta)

The **Live voice** switch in the panel uses xAI's [speech-to-speech API](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech) instead of the step-by-step pipeline above:

- **Connection:** the browser asks the server for a short-lived client secret (`POST /api/realtime/session`, which calls `/v1/realtime/client_secrets`), then connects straight to `wss://api.x.ai/v1/realtime` using the `xai-client-secret.` subprotocol. The API key never reaches the browser.
- **Audio:** the mic streams as 24 kHz PCM16, and Grok's voice streams back and plays immediately. xAI's server detects when you're talking, so speaking over Grok stops its playback and tells the server how much was heard (`conversation.item.truncate`).
- **Drawing:** Grok's function calls run in that tab with the same executor, so the drawing syncs to everyone. Results go straight back, and the next turn is requested once the current audio finishes, as xAI recommends.
- **Seeing the board:** the voice model can't take images, so its `look_at_board` tool sends a snapshot to `POST /api/describe`, where `grok-4.7` describes it.
- **Student work:** the "ask before changing student work" rule runs in the browser for these calls (`studentWorkPrompt`).
- **Limits:** it's one person and Grok. Others in the room see the drawing but don't hear the conversation. Grok sends its drawing calls after each spoken reply, so drawing lands at the end of a sentence rather than during it.

## Tests

```bash
npm test                                   # server unit tests (guard, review pipeline, routing, change log)
npm run build && npm start &               # then, in another shell:
npm run test:e2e                           # two browsers + mock agent, end to end
npm run test:voice                         # live Grok: fake microphone asks a question out loud (needs XAI_API_KEY)
npm run test:review                        # live Grok: Check my work on a hand-drawn design (needs XAI_API_KEY)
npm run test:realtime                      # Live voice client against a local fake of xAI's realtime API
                                           #   (server needs REALTIME_URL=ws://localhost:8790; XAI_API_KEY for look_at_board)
```

The e2e script (`e2e/collab.mjs`) runs two students in one room. The agent draws a diagram that both see. Bob draws a box and freehand ink, presses **Check my work**, and the agent annotates his work by name. It then animates a two-pointer array walkthrough. Set `CHROMIUM_PATH` to use a preinstalled Chromium.

## Status and known gaps

- **Tested against live Grok** (`grok-4.7`, Grok TTS/STT): a fake microphone asked a question out loud. It took about 3.5s from the end of the question to Grok's voice starting, with the diagram drawn while it spoke. Interrupting mid-explanation worked, and Check my work correctly read hand-drawn arrows from the board image. See `e2e/voice.mjs`.
- **Live voice has not run against xAI's real WebSocket yet.** The development sandbox can't open WebSockets to xAI. The client was built from xAI's protocol docs and schema, and tested end to end against a local fake server that follows them (`e2e/fake-realtime.mjs`). The real token endpoint and the `look_at_board` vision step were tested live.
- **Echo cancellation depends on the browser.** The detector raises its threshold while the agent is speaking. Headphones are still the most reliable setup if the agent keeps interrupting itself.
- **Tool execution needs a connected browser.** Exporting images and laying out shapes needs a real tldraw editor, so tool calls run in a participant's tab instead of a headless client on the server. If that tab disconnects, the next tool call moves to another connected participant.
- **No authentication.** Anyone with a room link can join, and identities are self-declared names.
