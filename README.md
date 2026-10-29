# Grok Design

A shared, voice-driven UI and wireframe design tool. You describe app screens out loud (or type), and Grok Design, an xAI Grok agent, builds them on a Figma-like [tldraw](https://tldraw.dev) canvas while it talks. Then you keep the conversation going: "make the button green", "add a toggle", "switch to dark mode", "add a sign-up screen and connect it". Several people can join the same file, edit alongside the agent, and ask it for a critique.

The design behind the pivot from the earlier teaching whiteboard is in [`docs/DESIGN_PLAN.md`](docs/DESIGN_PLAN.md).

## Quick start

```bash
npm install
cp .env.example .env          # optional: add XAI_API_KEY
npm run dev                   # server on :8787, client on :5173
```

Open http://localhost:5173. You'll be sent to a new file (`/r/<id>`). Use **Invite** to copy the link and open it in another browser to collaborate.

Without `XAI_API_KEY`, the server uses a **scripted mock agent** (the panel shows a *Demo* badge), so every flow works offline:

- "Design a login screen", "Build a dashboard", "Make a landing page", "Onboarding", "Settings" build a first draft. Other requests get a generic screen named after your words.
- Edits: "make the button green", "add a toggle / button / input / image / checkbox / text", "rename the title to …", "delete the …", "switch to dark mode" / "light mode", "add a sign-up screen and connect it".
- **Critique** reads the canvas, highlights nodes and leaves comments addressed to whoever edited them.

Production build: `npm run build && npm start` (the server serves `client/dist` on :8787).

## Voice conversation

Tap the mic in the floating **voice dock** (or the Agent tab) once and just talk. The mic stays open, hands-free.

- **Listening:** the browser records with echo cancellation and detects when you start and stop talking. Each utterance goes to Grok speech-to-text (`POST /api/stt`), biased toward design vocabulary.
- **Designing:** the agent streams Grok's reply. Each step is one or two short spoken sentences plus that step's tool calls. Tool calls run as soon as they stream in, and the next step waits for the current line to finish, so the canvas stays in step with the voice. A sentence is spoken as soon as the model pauses after it (it doesn't wait for the tool call that follows).
- **Building in pieces:** xAI delivers each tool call whole, and the model writes about 100 tokens a second, so a screen appears section by section: a small `create_screen` first, then one `add_nodes` per section in the same response. Specs stay short: defaults are omitted, repeated rows are one `template` + `items`, and higher-level kinds (`badge`, `chart`, icon tiles, tab bars, the automatic status bar) replace dozens of nodes. When the model ends a building step with its question and every call ran cleanly, the turn ends without another round trip.
- **Two models:** new screens and rebuilds use `XAI_MODEL` at `XAI_REASONING_EFFORT` (`minimal` by default: `low` sometimes thinks for 20s before drawing). Small edits to existing screens (colors, spacing, text, theme, adding a control) go to the fast non-reasoning `XAI_EDIT_MODEL`, which changes the canvas in about 1.5s.
- **No dead air:** a short cached acknowledgement ("Sure.") plays the moment you stop talking. A fast non-reasoning model (`XAI_OPENER_MODEL`) runs in parallel with the designer and speaks one sentence about what it is about to do about 1s later. It may not describe visuals (sentences naming colors, imagery or layout the request didn't mention are dropped), and the designer skips a first sentence that repeats it.
- **Speaking:** the server starts Grok text-to-speech right away and streams the audio to everyone in the room (`GET /api/tts/:id`). The dock captions the agent's current line.
- **Instant skeleton:** a request for a new screen puts a placeholder of it on the canvas within about a second (the screen with soft blocks where its sections will go, picked from the request: dashboard, landing, login, onboarding, settings or list; desktop or phone). The designer's first `create_screen` replaces it in place; a skeleton the turn never replaced is removed when the turn ends (`create_skeleton` / `remove_skeleton`, server-only executor calls).
- **Steering, briefly:** the agent builds a sensible first draft instead of asking questions. A turn says one status line (the opener's, or the designer's when the opener said nothing) and one steering question about something it just built, never one it asked before; the question plays after that step's tool calls ran. Extra status sentences, "let me check the canvas" filler and colors the request didn't mention (spoken before the drawing exists, so they can't be checked) are not spoken. A failed or declined change earns one more line.
- **Interrupting:** talking over the agent cuts its voice off, and your request takes over the turn.
- **Fallback:** without Grok voice (no key, or `VOICE=browser`), the browser's Web Speech API does recognition and speech (`client/src/agent/speech.ts`).

### Live voice (beta)

The **Live voice** switch in the Agent tab uses xAI's [speech-to-speech API](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech) instead of the step-by-step pipeline:

- The browser gets a short-lived client secret (`POST /api/realtime/session`), then connects straight to `wss://api.x.ai/v1/realtime`. The API key never reaches the browser.
- Mic audio streams as 24 kHz PCM16 and Grok's voice plays as it arrives. Server-side VAD handles turn taking; talking over Grok stops playback and reports how much was heard (`conversation.item.truncate`).
- Grok's function calls (the same design tools) run in that tab and sync to everyone. `look_at_board` sends a snapshot to `POST /api/describe`, where the vision model describes it, because the voice model can't take images.
- The "ask before changing someone's work" rule runs in the browser for these calls.
- It's one person and Grok: others see the design change but don't hear the conversation.

## Design model

Everything is one custom tldraw shape, `ui` (`shared/design.ts`, rendered by `client/src/design/UiShapeUtil.tsx`, registered in the server schema too).

- **Screens** are top-level artboards (`kind: 'screen'`) sized from device presets: iPhone 390×844, Android 412×915, tablet 834×1194, desktop 1440×1024, watch 198×242. New screens go to the right of the existing ones.
- **Nodes** nest inside screens as real tldraw children: `frame`, `text`, `button`, `input`, `image`, `icon`, `avatar`, `toggle`, `checkbox`, `divider`, `rect`, `badge`, `chart`. Kind defaults (`KIND_DEFAULTS`) keep specs short, e.g. a button is 48px tall, hugs its label and uses `$primary`; a badge is a 13/600 pill that always hugs its label.
- **Generated visuals** (`shared/visuals.ts`, SVG shared by the canvas and the HTML export): `image` nodes are abstract art in the brand's hues (soft gradient blobs, rings, or a sun over layered hills, picked from the alt text and stable per node), never a gray box. `chart` nodes draw a bar or line chart from `data` / `labels` (kept in `meta.chart`) with four labelled gridlines (abbreviated: $60k, 1.2M) and the highlighted value (default: the peak, exact when short: $62,410). A currency chart whose data is in thousands next to KPIs in full dollars gets a `k` suffix automatically. An `icon` with a fill is an icon tile. Google and Apple marks are filled brand glyphs.
- **Phone chrome:** phone-sized screens draw an iOS status bar and home indicator, and an optional bottom tab bar (`create_screen` `tabs` + `activeTab`, in `meta.tabs`). Layout keeps content clear of them (`effectivePadding`).
- **Templates:** a frame with `template` + `items` repeats the template once per item, replacing `{key}` in its strings (`expandTemplates`); a field that is just `"{key}"` is dropped when the item lacks it, so only the active nav item needs a fill.
- **Growing screens:** when the agent's content doesn't fit, the screen grows taller (like a scrolling page) instead of clipping. On desktop pages, fixed-width blocks in the page column are centered, rows of cards default to equal heights.
- **Auto layout** works like Figma's: containers have `layout` vertical / horizontal / none, `gap`, `padding`, `alignItems`, `justify`; children size `fixed`, `hug` or `fill`. The layout engine is pure and shared (`layoutTree`, unit tested); the executor re-runs it on the affected screen after every structural edit.
- **Tokens and themes:** colors are hex or tokens (`$bg $surface $surfaceAlt $primary $primarySoft $onPrimary $text $muted $border`, and status pairs `$success/$successSoft $warning/$warningSoft $danger/$dangerSoft`) resolved against the screen's `meta.theme` (`light` / `dark`, plus a primary color). Dark mode is one `set_theme` call; a new screen inherits the latest screen's theme. Token text and icon colors are nudged to 4.5:1 against whatever is behind them (`inkOn`: e.g. `$primary` on a dark `$primarySoft` nav pill), on the canvas and in the HTML export; explicit hex colors are left as chosen.
- **Authorship:** each tab stamps `meta.author` / `meta.updatedBy` (`{ kind: 'user' | 'agent', id, name }`) on what it creates or edits (`client/src/agent/authorship.ts`).

## Agent tools

Defined in `shared/tools.ts`, executed in a participant's browser by `CanvasExecutor` (`client/src/agent/executor.ts`), so edits sync like any other edit.

| Group | Tools |
| --- | --- |
| Design | `create_screen` (a whole screen tree in one call; same id replaces it), `add_nodes`, `update_node`, `move_node`, `delete_nodes`, `duplicate_screen`, `set_theme`, `connect_screens` (prototype flow arrow), `focus_view`, `clear_canvas` |
| Reading | `get_canvas_state` (screens as nested trees; default-valued props and auto-layout positions are omitted to save tokens), `get_canvas_image`, `get_recent_changes` (server change log), `get_participants` |
| Feedback | `highlight_shapes`, `add_comment` (`issue`, `suggestion`, `praise`, `question`, addressed to a collaborator) |
| Live voice only | `look_at_board` |

Tool results include warnings when content overflows its row or a label is clipped, so the model can fix it. Exports (Export PNG, Copy as PNG, the agent's `get_canvas_image`) paint each screen's own themed background: tldraw skips the frame itself when exporting a single frame, so `UiShapeUtil` routes single-screen exports through the normal path. **Honest critiques:** a critique turn starts from `get_canvas_state` with `audit: true`: measured problems per screen from real bounds and rendered colors (content overflowing its frame or the screen, clipped labels, text contrast under 4.5:1 or 3:1 for large text, phone buttons/inputs under 44px, text under 12px, card rows with unequal heights). The model is told these are the only geometry/contrast problems that exist; `add_comment` rejects an issue or suggestion that claims one the audit didn't measure, and the server doesn't speak such a sentence (`unsupportedClaim` in `shared/design.ts`). Critique notes use the UI font, scale with the zoom, size to their text, and sit beside the target's screen (right, left, then below/above), clear of screens, their name labels and other notes, where the connector to the node is short and crosses no other screen. Modes: **On request** (Critique button or voice), **Proactive** (comments after collaborators pause for `IDLE_MS`) and **Guided** (the agent leads, one decision at a time).

**Respecting people's work:** `AgentSession.guard` (server) checks every call against the server's copy of the shapes. Changing or deleting a node a collaborator authored needs someone to click **Allow** first. Annotations never touch their nodes.

## App shell

`client/src/shell/`:

- **Top bar:** file name, **Insert** menu (screen presets by device; components: button, input, heading, text, image, card, navbar, list item, toggle, checkbox, avatar, divider, inserted into the selected screen or frame), screen theme toggle, Export (Copy code, PNG), Invite, collaborators.
- **Layers** (left): screens and nested nodes; click to select, hover to highlight, double-click to rename.
- **Design** tab (right): properties of the selected node: size and sizing, auto layout, theme and primary color (screens), fill / text / stroke colors with token swatches, radius, opacity, shadow, typography, content, and export (**Copy code**: standalone HTML/CSS for the node or screen, PNG @2x). With nothing selected it lists screens and new-screen presets.
- **Agent** tab (right): conversation, text input, Critique, mode, mute, Live voice.
- **Voice dock** (floating over the canvas): mic plus live captions. Zoom to fit (agent `focus_view`, Shift+1 and Shift+2) leaves room for it. The agent's cursor shows where it is working and fades out a few seconds after it goes idle.

## Architecture

```
 Browser (Alice)                Browser (Bob)
 ┌───────────────────┐          ┌───────────────────┐
 │ tldraw + useSync  │◄────────►│ tldraw + useSync  │   /sync/:room   (tldraw sync protocol)
 │ shell, voice dock │          │ shell, voice dock │   /agent/:room  (agent protocol, shared/protocol.ts)
 └─────────┬─────────┘          └─────────┬─────────┘
           └──────────────┬───────────────┘
                 Node server (server/src)
   rooms.ts   TLSocketRoom per room (SQLite), shape mirror, change log
   agent.ts   AgentSession per room: Grok tool loop, guard, critique triggers
   llm.ts     xAI chat-completions client (mock.ts = offline stand-in)
   voice.ts   Grok TTS/STT; realtime.ts = Live voice tokens + /api/describe
```

Tool calls run in a connected browser because layout and image export need a real tldraw editor. The participant who started the turn runs them; if that tab disconnects, the next call moves to another participant.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `XAI_API_KEY` | (none, uses the mock agent) | xAI API key |
| `XAI_MODEL` | `grok-4.7` | Chat model with tool calling and image input (also the vision model for `/api/describe`) |
| `XAI_OPENER_MODEL` | `grok-4.20-non-reasoning` | Fast model that speaks the first sentence while the main model designs (`off` disables) |
| `XAI_REASONING_EFFORT` | `minimal` | Reasoning effort for design turns (`XAI_REVIEW_REASONING_EFFORT`, `low` by default, for critiques: `medium` found the same issues but left about 10s of silence) |
| `XAI_EDIT_MODEL` | `grok-4.20-non-reasoning` | Fast model for small edits to existing screens (`off` sends everything to `XAI_MODEL`) |
| `XAI_VOICE` | `ara` | Grok voice (`GET https://api.x.ai/v1/tts/voices` lists them) |
| `XAI_REALTIME_MODEL` | `grok-voice-latest` | Speech-to-speech model for Live voice |
| `REALTIME` | `on` | `off` hides the Live voice option |
| `VOICE` | `grok` | `browser` forces the Web Speech API fallback even when an API key is set |
| `AGENT_PROVIDER` | (auto) | `mock` forces the scripted agent even when an API key is set |
| `XAI_BASE_URL` | `https://api.x.ai/v1` | OpenAI-compatible endpoint |
| `PORT` | `8787` | Server port |
| `DATA_DIR` | `server/data` | Room databases (SQLite) and uploaded images |
| `PERSIST` | `true` | `false` keeps rooms in memory only |
| `IDLE_MS` | `4000` | Proactive mode: how long collaborators must pause before the agent looks |
| `AGENT_DEBUG` | (off) | Log each agent step and tool call |
| `VITE_TLDRAW_LICENSE_KEY` | (none) | tldraw license key, needed for production deployments (without it tldraw shows its "Get a license" notice, which must stay) |

The server reads `.env` from the repo root on start.

## Tests

```bash
npm run typecheck
npm test                                   # server unit tests: layout engine, guard, agent loop, routing, change log
npm run build && npm start &               # mock agent (no XAI_API_KEY); then, in another shell:
npm run test:e2e                           # two collaborators + mock agent, multi-turn conversation
npm run test:voice-browser                 # browser-voice fallback: dock mic, spoken turns, captions, barge-in
npm run test:realtime                      # Live voice client against a local fake of xAI's realtime API
                                           #   (server needs REALTIME_URL=ws://localhost:8790 and any XAI_API_KEY,
                                           #   e.g. AGENT_PROVIDER=mock VOICE=browser; look_at_board's vision step
                                           #   is skipped when xAI is unreachable)
npm run test:voice                         # live Grok: fake microphone asks for a login screen (needs XAI_API_KEY)
npm run test:review                        # live Grok: Critique of a flawed checkout screen (needs XAI_API_KEY)
npm run test:live                          # live Grok: 5 typed turns (login, brown button, remember-me toggle, dark mode,
                                           #   menu screen + flow) and a Critique; checks layout, prints latencies, OUT_DIR screenshots
npm run test:realtime-live                 # Live voice against xAI's real realtime WebSocket (server without REALTIME_URL)
```

- `e2e/collab.mjs`: Alice asks for a login screen, then continues in the same session ("make the button green", "add a toggle", "switch to dark mode", "add a signup screen and connect it"). After each turn both browsers are checked through `window.__editor`: node props, `meta.theme`, the flow arrow's bindings, layers. It also checks the agent cursor hides when idle and the fitted screen clears the voice dock. Bob retitles a node in the Design panel and presses Critique; the agent highlights his change and comments "@Bob …". Bob inserts a node, Alice asks to delete it, and the agent has to get an **Allow** first.
- `e2e/voice-browser.mjs` replaces the Web Speech API with a scripted stand-in (headless Chromium has no working recognition or voices) and drives the real dock mic, hands-free loop, captions and barge-in.
- `e2e/question.wav` was synthesized with flite ("Hey, can you design a login screen for my coffee app?").

Set `CHROMIUM_PATH` to use a preinstalled Chromium and `OUT_DIR` for screenshots.

## Status and known gaps

- **Verified live against xAI** (grok-4.7, opener grok-4.20-non-reasoning, voice ara, grok-voice-latest; Oct 2026): `test:voice`, `test:review`, `test:live`, `test:realtime-live`, and `test:realtime`'s vision step. Typical numbers (typed turns, measured from sending, Oct 29 2026): cached ack 0.1s, opener voice about 1-2s, the designer's own first sentence 4-8s, first canvas change 1.3-1.7s for edits and 7-15s for a new screen (onboarding 8-11s, settings 5-8s, landing 10-12s, desktop dashboard 13-16s; it then fills in section by section), turn done 15-30s (mostly the voice finishing). Before this round (one big create_screen, `low` effort, opener awaited before the designer started) new screens took 24-43s. Critique: voice after 6-11s. Voice test: first audio about 1.3s after the user stops talking, longest silence about 4s.
- **Live voice works against xAI's real WebSocket:** client secret, `session.update`, server VAD, transcription, streamed voice (about 1s after VAD detects the end of the question) and function calls that build a screen.
- **Speech can still recap.** Grok sometimes restates what it just built before its closing question, and the fast opener occasionally announces details the design then doesn't use.
- **Hard-coded colors:** for "make the button brown" Grok sets a hex fill, which (correctly) doesn't follow dark mode. `$primary` is lightened automatically in dark mode when the brand color is too dark to read.
- **Proxies:** the server's `fetch` honors `HTTPS_PROXY` (`NODE_USE_ENV_PROXY=1` in the server scripts). The browser's Live voice WebSocket uses the browser's own proxy settings.
- **The mock agent is scripted.** It recognizes a fixed set of screens and edit phrases, and edits the newest screen.
- **Comment placement is simple.** Comments go to the right of the screen and are nudged to the nearest free spot, which can land far from the node when screens are packed.
- **Code export is a starting point:** static HTML/CSS with absolute sizes from the layout, no components or responsiveness.
- **Echo cancellation depends on the browser.** Headphones are the most reliable setup if the agent keeps interrupting itself.
- **No authentication.** Anyone with a file link can join, and names are self-declared.
