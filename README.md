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
| `XAI_VOICE` | `ara` | Grok voice for the agent (`GET https://api.x.ai/v1/tts/voices` lists them) |
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
  - *Pacing:* each step is one short spoken line plus that step's drawing. The next step waits for the line to finish, so the drawing stays in step with the voice.
  - *Interrupting:* talking over the agent cuts its voice off immediately, and your question takes over the turn.
  - *Fallback:* without an API key, the browser's Web Speech API is used instead (`client/src/agent/speech.ts`).

## Tests

```bash
npm test                                   # server unit tests (guard, review pipeline, routing, change log)
npm run build && npm start &               # then, in another shell:
npm run test:e2e                           # two browsers + mock agent, end to end
npm run test:voice                         # live Grok: fake microphone asks a question out loud (needs XAI_API_KEY)
npm run test:review                        # live Grok: Check my work on a hand-drawn design (needs XAI_API_KEY)
```

The e2e script (`e2e/collab.mjs`) runs two students in one room. The agent draws a diagram that both see. Bob draws a box and freehand ink, presses **Check my work**, and the agent annotates his work by name. It then animates a two-pointer array walkthrough. Set `CHROMIUM_PATH` to use a preinstalled Chromium.

## Status and known gaps

- **Tested against live Grok** (`grok-4.7`, Grok TTS/STT): a fake microphone asked a question out loud. It took about 3.5s from the end of the question to Grok's voice starting, with the diagram drawn while it spoke. Interrupting mid-explanation worked, and Check my work correctly read hand-drawn arrows from the board image. See `e2e/voice.mjs`.
- **Not the realtime voice API yet.** xAI also offers a streaming speech-to-speech WebSocket (`wss://api.x.ai/v1/realtime`, with browser tokens from `POST /v1/realtime/client_secrets`), which could cut latency further. It wasn't used because the development sandbox can't open WebSockets to xAI, so it couldn't be tested.
- **Echo cancellation depends on the browser.** The detector raises its threshold while the agent is speaking. Headphones are still the most reliable setup if the agent keeps interrupting itself.
- **Tool execution needs a connected browser.** Exporting images and laying out shapes needs a real tldraw editor, so tool calls run in a participant's tab instead of a headless client on the server. If that tab disconnects, the next tool call moves to another connected participant.
- **No authentication.** Anyone with a room link can join, and identities are self-declared names.
