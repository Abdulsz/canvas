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
| `XAI_MODEL` | `grok-4` | Any xAI chat model with tool calling and image input |
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
- **Voice.** Each agent step is one short spoken line plus that step's drawing. The server waits for the line to finish before running the next step's tools, so the drawing stays in step with the voice. Voice uses the browser's Web Speech API (`client/src/agent/speech.ts`): speech synthesis for the agent and speech recognition for students. Talking over the agent interrupts it.

## Tests

```bash
npm test                                   # server unit tests (guard, review pipeline, routing, change log)
npm run build && npm start &               # then, in another shell:
npm run test:e2e                           # two browsers + mock agent, end to end
```

The e2e script (`e2e/collab.mjs`) runs two students in one room. The agent draws a diagram that both see. Bob draws a box and freehand ink, presses **Check my work**, and the agent annotates his work by name. It then animates a two-pointer array walkthrough. Set `CHROMIUM_PATH` to use a preinstalled Chromium.

## Status and known gaps

- **Grok voice.** Voice I/O currently uses the browser's Web Speech API (best in Chrome/Edge), not xAI's streaming voice API. It sits behind `speak` / `startListening` in `speech.ts`, so a Grok voice client can replace it without other changes.
- **Not yet run against the live xAI API.** The Grok client uses the standard chat-completions request with `tools`. It has been checked against the mock provider only. Model output may need prompt tuning.
- **Tool execution needs a connected browser.** Exporting images and laying out shapes needs a real tldraw editor, so tool calls run in a participant's tab instead of a headless client on the server. If that tab disconnects, the next tool call moves to another connected participant.
- **No authentication.** Anyone with a room link can join, and identities are self-declared names.
