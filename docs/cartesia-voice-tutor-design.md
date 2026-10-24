# Voice tutor on Cartesia: design

Status: design for a hackathon prototype, not built yet (written 2026-10-24).
Track: **Best Use of Cartesia**. Judged 25% each on problem and originality, use of Cartesia, execution, and impact and responsibility. A strong working prototype beats a large unfinished idea.

Cartesia API details below come from search summaries of docs.cartesia.ai, because the docs were not reachable from the session that wrote this. Every item marked **(verify)** must be checked against the docs in Phase 0 before it is relied on.

---

## 1. Summary

A whiteboard tutor that teaches by talking while it draws, and that listens and watches while you practice.

- **Learn:** "Teach me how a URL shortener scales." The tutor explains out loud and each shape appears on the exact word that names it. You can cut in at any moment.
- **Practice:** "Your turn: add the write path." You draw and think out loud. The tutor stays quiet while you're mid-thought. At natural pauses it says one helpful sentence and marks the board. When you say "done", it reviews your work.

Voice is the product, not a feature. Your hands are on the board and your eyes are on the diagram, so speech is the only channel left free. The tutor teaches the way a person at a whiteboard does: talking and drawing at the same moment. In practice, thinking aloud is the skill being trained, and it's what the tutor listens to.

**Cartesia is the ears and the voice. Grok is the brain and the eyes. tldraw is the board.**

## 2. Goals and non-goals

Goals:
1. One complete flow that works every time: Learn, then "your turn", then Practice, then a review.
2. Drawing lands on the spoken word (within about 150 ms).
3. Interrupting the tutor stops its voice within about 200 ms, and the tutor knows what you actually heard.
4. In Practice, the tutor never answers think-aloud chatter, and never talks over you.
5. Captions, a text path, speed control, a clear mic indicator, and no stored audio.

Non-goals for the prototype: phone calls, voice cloning, languages other than English, accounts or auth, polishing the phone layout, multi-page boards.

## 3. What exists today (reuse it)

The repo already works end to end, and these parts stay:

- **Board and sync:** tldraw multiplayer, one SQLite room per board (`server/src/rooms.ts`), authorship on every shape (`client/src/agent/authorship.ts`).
- **Agent loop:** Grok tool calling, streamed, with each tool call run as it arrives (`server/src/agent.ts`, `server/src/llm.ts`). Tools run in a participant's browser (`client/src/agent/executor.ts`).
- **Review:** Check my work gathers the board state up front, adds an image when there's freehand ink, and annotates with `highlight_shapes`, `add_comment` and `suggest_correction`.
- **Student-work guard:** asks before the agent changes a student's shapes (`AgentSession.guard`). It has a gap; see §20.
- **Reusable audio code:** `client/src/agent/realtime.ts` has a 24 kHz PCM16 AudioWorklet capture, base64 PCM helpers, gapless scheduled playback (`nextTime`) and "how much was heard" math. `client/src/agent/speech.ts` has a voice activity detector with an adaptive noise floor and a higher threshold while the tutor speaks.
- **Mock agent and tests:** `server/src/mock.ts`, `server/test/agent.test.ts`, and `e2e/*.mjs` (including a fake realtime server pattern in `e2e/fake-realtime.mjs`).

Voice today is xAI: one TTS request per sentence served over `GET /api/tts/:id` (`server/src/voice.ts`), one recorded upload per utterance for STT (`POST /api/stt`), and an xAI speech-to-speech "Live voice" mode. All of it gets replaced.

Measured against live Grok on 2026-10-24, with typed questions:

| What | Result |
| --- | --- |
| First shape after pressing Enter | 5–6 s |
| Each step: time to first sentence | 1.0–2.6 s |
| Each step: time until all tool calls arrive | 3.1–5.0 s |
| URL shortener lesson | 6 steps, 68 s |
| Check my work on a hand-drawn design | 26 s, correct feedback |

Two problems showed up:

- **The drawing trails the voice by 1–2 s in each step.** Grok streams the sentence first and the tool calls after it.
- **The fast "opener" model gave away the binary search answer** before anything was drawn, and the main model then repeated it.

## 4. What Cartesia contributes

| Need | Cartesia feature | Where it lives |
| --- | --- | --- |
| The tutor's voice, fast | Sonic TTS over WebSocket (`/tts/websocket`), streamed raw PCM | `server/src/cartesia.ts` |
| A step sounds like one utterance, not separate sentences | Continuations: same `context_id`, `continue: true` until the last input | `server/src/cartesia.ts` |
| Shapes appear on their word, captions highlight the spoken word, and the tutor knows what was heard when cut off | Word timestamps (`add_timestamps: true`, `type: "timestamps"` messages with `word_timestamps {words, start, end}`) | `server/src/speech-sync.ts`, `client/src/agent/player.ts` |
| Stop at once when interrupted | `cancel` on the context | `server/src/cartesia.ts` |
| Hear the student while they talk and draw | Streaming STT (`/stt/websocket`, `ink-whisper` or `ink-2`), finalize after a pause | `client/src/agent/listen.ts` |
| The API key never reaches the browser | Access tokens (`POST /access-token`) with only the STT grant | `server/src/index.ts` `POST /api/voice/token` |
| Comfortable pace, warmth for praise | `generation_config.speed` (0.6–1.5) and `emotion` | per-say options |
| Technical words said right | Custom pronunciations **(verify)**, plus the existing respelling map | `server/src/voice.ts` `PRONUNCIATIONS` |

The other tools:

- **Grok** (xAI API) for reasoning, tool calls, and vision on board snapshots.
- **tldraw** for the canvas and multiplayer sync.
- **Node** for the server.

The README must keep this split explicit.

## 5. Architecture and the main decision

```
 Browser (driver = the student whose turn it is; others just listen)
 ┌───────────────────────────────────────────────────────────────────┐
 │ mic ─► AudioWorklet PCM16 16 kHz ─┬─► Cartesia STT WS (direct, token) │
 │                                   └─► VAD: speaking? barge-in? finalize│
 │ transcripts, activity ───────────────────────────────┐               │
 │ tldraw edits ─────────── /sync/:room ───────────────┐│               │
 │ PCM player + word clock ◄── say_audio / say_words ──┼┼── /agent/:room │
 │ executor: staged shapes, reveal on word ◄─ tool_call┘│               │
 └──────────────────────────────────────────────────────┼───────────────┘
                                                        │
 Node server ───────────────────────────────────────────┴───────────────
   rooms.ts      tldraw room, shape + binding mirror, change log
   agent.ts      Learn turns: Grok step loop with staging and lookahead
   practice.ts   timeline (speech + edits), pause gate, cooldowns
   cartesia.ts   one TTS WebSocket, many contexts, timestamps, cancel
   speech-sync   [[marker]] parsing, word alignment
        │                         │
     xAI Grok               Cartesia Sonic TTS (server) / access tokens
```

**Decision: keep our own agent loop in Node, and use Cartesia for all speech in and out.** Why:

1. Drawing on the word needs word timestamps next to the audio. With our own TTS connection we get both.
2. Practice mode needs a custom rule for when to speak, driven by board edits and pauses. Normal "you spoke, so I reply" turn-taking is wrong for think-aloud.
3. It keeps the working loop, the vision review, the guard and the tests.

Cartesia's agent platform (Line) is the alternative; see §19. Only switch if the Phase 0 spike passes its checks.

## 6. Voice pipeline

### 6.1 Speaking

- **One shared connection.** The server keeps one Cartesia TTS WebSocket open and runs many contexts over it. Open it at startup, reconnect with backoff, and send a keepalive so the idle timeout doesn't close it.
- **One context per agent step.** Use `context_id = <room>:<stepId>`. Send each sentence as it streams in, with `continue: true`. When the step's text is complete, send `continue: false`.
  - **(verify)** whether timestamps are relative to the start of the context or to each input.
- **Request fields** **(verify names)**:
  - `model_id: "sonic-3"`. Speed and volume are reported disabled on `sonic-3.5`, so pin `sonic-3` if you use them.
  - `voice: { mode: "id", id: CARTESIA_VOICE_ID }`
  - `output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 24000 }`
  - `language: "en"`, `add_timestamps: true`
  - `generation_config: { speed }`
  - The `Cartesia-Version` header. Docs mention `2026-03-01`.
- **Relay to everyone in the room:**
  - Each `chunk` becomes `say_audio {sayId, seq, data}`.
  - Each `timestamps` message becomes `say_words {sayId, words, start, end}`.
  - `done` becomes `say_end`.
  - An `error` switches to the fallback (§10).
- **Client player** (`client/src/agent/player.ts`, lifted from `realtime.ts`):
  - Plays from one AudioContext, scheduling PCM buffers back to back.
  - Records each say's start time on the audio clock.
  - A requestAnimationFrame loop fires `onWord(sayId, index)` as `ctx.currentTime` passes each word's start.
  - Says play in order, so step N starts when step N−1 ends.
  - The driver sends the existing `speech_done` when a say's last sample has played.
- **Instant acknowledgements.** Synthesize the acks ("Sure.", "Let me take a look.") once at startup and keep the PCM and timestamps in memory. Replay instantly.
- **Respellings.** Keep `PRONUNCIATIONS` (gRPC to "G R P C" and so on), applied only to the text sent to TTS. Captions show the original text. The alignment in §6.2 maps between the two.

### 6.2 Drawing on the word

**Markers.** The prompt tells the model to put `[[id]]` (or `[[id1,id2]]`) right before the words that name a shape it draws in this step:

> Requests hit the [[lb]]load balancer, which spreads them across [[app1,app2]]two app servers.

The server strips markers as text streams in, so they never reach TTS or captions. It then records each marker's word index in the cleaned text. A marker binds to the first word after it; a marker at the very end binds to the last word.

**Staging.** Tool calls still run as soon as they stream in, but staged:

- The executor creates the shapes with `opacity: 0` and `meta.staged = { stepId }`.
- Tool results, including final positions after nudging, go back to the model immediately.
- Staged arrows are hidden too.

**Reveal.** The driver reveals staged shapes at their marker's word (set opacity to 1), and the reveal syncs to everyone through tldraw. Defaults when there's no marker:

- An arrow reveals when both of its ends are visible.
- Any other unmarked shape reveals on the step's first word.
- Anything still hidden reveals when the step's audio ends, as a safety net.

**Word alignment** (`server/src/speech-sync.ts`, pure functions, unit tested). Cartesia's word list can differ from a whitespace split of our text: "O(n log n)", numbers and respellings get normalized. Align the two sequences by matching lowercased alphanumeric tokens. If alignment fails, map by relative position (character offset ÷ text length × say duration).

**Lookahead, which replaces today's gate.** Today step N's tool calls wait for step N−1's speech to finish (`agent.ts`: `tools = step === 0 ? Promise.resolve() : previous`). That ties model, tools and speech together. New rule:

- Step N+1's model request starts as soon as step N's stream has ended and its staged tool calls have returned.
- It doesn't start before step N−1's audio has finished, so at most one step is buffered ahead of what the student hears.

**Board edits between steps.** In Learn mode, if a student drew something during the previous step, add a one-line note to the next request ("Ana just added a box labeled Cache"), so the tutor can react to it.

**Opener.** Measure first. With the cached ack and Cartesia's fast first audio, the gap from end of speech to the first explanatory word may already be under 2 s. If so, drop the opener. If you keep it, its prompt must say: frame the approach, never state the answer.

### 6.3 Listening

- **Token.** The browser calls `POST /api/voice/token`. The server calls Cartesia `POST /access-token` with the STT grant only and a short expiry (about 60 s).
  - **(verify)** whether the token only needs to be valid when the socket opens.
- **Socket.** The browser opens `wss://api.cartesia.ai/stt/websocket?model=…&encoding=pcm_s16le&sample_rate=16000&language=en`, with the token as a query parameter **(verify the parameter name)**.
  - Capture with the AudioWorklet from `realtime.ts`, resampled to 16 kHz, and send binary frames.
- **Model choice.**
  - `ink-whisper` gives word timings and more languages.
  - `ink-2` is English only and sends only final transcripts.
  - Pick the one with the lower finalize-to-final latency in Phase 0.
- **End of speech.** The voice activity detector stays in the browser (from `speech.ts`). About 650 ms after speech ends, send `finalize` and join the `is_final` text, keeping whitespace.
  - Then send `user_speech {text, final: true, startedAt, endedAt}` to the server.
  - Also send `user_activity {speaking: true|false}` on every voice start and stop, so the server knows when the student is mid-sentence.
- **Lifetime.** Keep the socket open while the mic is on. The docs report a 3-minute idle timeout, so reopen on close or at the next voice start.
- **Push-to-talk.** Hold Space or the mic button. Same pipeline, with `finalize` on release. Useful for noisy rooms and for privacy.

### 6.4 Interruptions

On voice start while the tutor's audio is playing:

1. **Client:**
   - Stops playback within one audio buffer.
   - Shows "Listening".
   - Sends `barge_in {sayId, heardSec}`.
2. **Server:**
   - Aborts the Grok stream.
   - Sends `cancel` for the open TTS contexts.
   - Uses the word timestamps to work out the heard text.
   - Tells the driver to `discard_staged {stepId}`, which deletes shapes that were never revealed.
3. **History:**
   - Replace the step's assistant text with the heard part.
   - Add a note: `(Interrupted by Ana after "…". Not shown and removed: lb, app2.)`
   - The student's utterance then starts the next turn.

## 7. Practice mode

**Timeline** (`server/src/practice.ts`): one append-only list per room of `{t, who, kind, text}`. It's built from `user_speech` and the room change log, and shown to the model as lines like:

```
[12.3s] Ana said: "the cache sits in front of the database"
[13.0s] Ana drew an arrow from API Server to Cache
```

The server mirrors shapes but not binding records, so arrow from/to is missing on the server today. Extend `Room.applyDiff` to mirror `typeName: 'binding'`.

**When the tutor speaks:**

1. **Directly addressed: reply now.** The utterance is a question to the tutor, or matches done/check/help/hint phrases ("is this right?", "I'm done", "can I get a hint"). Use a regex first and let the gate model settle ambiguous cases.
2. **Thinking aloud: no reply.** Append it to the timeline. No ack, no voice.
3. **Pause gate.** No speech and no edits for `PAUSE_MS` (default 1500 ms), and something new since the last gate. Call a fast model (`grok-4.20-non-reasoning`, JSON output) with the task, its rubric, the structured board from the server mirror, and the last ~60 s of timeline. It returns `{action: "silent" | "nudge" | "speak", targetIds, note}`:
   - `silent`: do nothing.
   - `nudge`: a quiet visual hint (thin dashed orange highlight), no voice.
   - `speak`: call `grok-4.7` (with a board image if there's freehand ink) for ONE sentence plus annotation tools, using markers so the circle lands on the word.
4. **Cooldown.** At least 10 s between unprompted spoken remarks, and at most one per pause.
5. **Yield.** Just before playback starts, check again. If the student spoke or drew after the gate fired, drop the remark or turn it into a nudge.
6. **Stuck.** No edits or speech for about 25 s with the task unfinished: one gentle offer ("Want a hint?"), then wait.

**Task and review.** Two new tools:

- `start_practice {task, rubric: string[]}`. The tutor calls it to say "Your turn". The UI switches to Practice and shows a task card.
- `finish_practice {results: [{item, met, note}]}`. Used for the review after "done". It reuses the Check my work pipeline, speaks a summary, marks the board, and shows a ✓/✗ checklist in the panel.

## 8. Protocol changes (`shared/protocol.ts`)

Client to server:

- `user_speech {text, final, startedAt, endedAt}`. Typed text keeps `user_message`.
- `user_activity {speaking}`
- `barge_in {sayId, heardSec}`
- `set_mode {mode: 'learn' | 'practice'}`, replacing `on_request | proactive | exercise`
- `set_voice_prefs {speed}`
- Kept as they are: `tool_result`, `speech_done`, `check_work`, `stop`, `hello`

Server to client:

- `say_start {sayId, stepId, caption}`
- `say_audio {sayId, seq, data}` (base64 PCM16; binary frames are a later optimization)
- `say_words {sayId, words, start, end}`
- `say_end {sayId}`
- `reveal_plan {sayId, items: [{ids, wordIndex}]}` (driver only)
- `discard_staged {stepId}`
- `practice_state {task, rubric, results?}`
- `voice_status {state: 'ok' | 'degraded', reason?}`
- `tool_call` gains `staged?: {stepId}`

Removed: `audioUrl`, the `realtime` flag, and the Live voice paths.

## 9. File plan

Server:

| File | Change |
| --- | --- |
| `server/src/cartesia.ts` (new) | TTS socket (contexts, continue, timestamps, cancel, reconnect, keepalive), access token minting, in-memory cached clips |
| `server/src/speech-sync.ts` (new) | Marker parsing and word alignment, pure and unit tested |
| `server/src/practice.ts` (new) | Timeline, pause gate, cooldown, gate model call |
| `server/src/agent.ts` | Step pipeline with staging and lookahead, barge-in truncation, mode state, hook into practice |
| `server/src/rooms.ts` | Mirror binding records |
| `server/src/prompt.ts` | Marker rule, Learn and Practice rules, the two new tools, one sentence per remark in Practice |
| `server/src/llm.ts` | JSON-mode fast call for the gate; drop or fix the opener |
| `server/src/index.ts` | Add `POST /api/voice/token` and per-IP rate limits. Remove `/api/tts`, `/api/stt`, `/api/realtime/session`, `/api/describe` |
| `server/src/voice.ts` | Reduce to `PRONUNCIATIONS` plus helpers, or fold into `cartesia.ts` |
| `server/src/realtime.ts` | Delete |
| `server/src/mock.ts` | Emit markers, and a practice-gate script, so the offline demo still works |
| `shared/tools.ts` | Add `start_practice` and `finish_practice`. Remove `LOOK_AT_BOARD` and `REALTIME_TOOLS` |

Client:

| File | Change |
| --- | --- |
| `client/src/agent/player.ts` (new) | PCM player and word clock, lifted from `realtime.ts` |
| `client/src/agent/listen.ts` (new) | Worklet capture, VAD (from `speech.ts`), Cartesia STT socket, push-to-talk |
| `client/src/agent/speech.ts` | Keep only the browser fallbacks (speechSynthesis, Web Speech recognition) |
| `client/src/agent/executor.ts` | Staged create, `reveal(ids)`, `discardStaged(stepId)`, guard fix (§20) |
| `client/src/agent/useAgent.ts` | New messages, reveal scheduling, barge-in |
| `client/src/components/AgentPanel.tsx` | Learn/Practice switch, task card and checklist, live captions with the current word highlighted, speed control, push-to-talk, mic consent sheet, degraded-voice banner. Remove the Live voice switch |
| `client/src/agent/realtime.ts`, `useLiveVoice.ts` | Delete after lifting the audio code |

Rename `AGENT_NAME` ("Professor Grok"), because Grok no longer speaks. Pick the tutor's name and voice before recording.

## 10. Edge cases and fallbacks

| Case | Behavior |
| --- | --- |
| Mic denied | Banner, typed input keeps working, captions still play |
| No Cartesia key, or TTS errors or times out | `voice_status: degraded` banner, browser speechSynthesis. No timestamps, so shapes reveal at sentence start |
| STT socket fails | Fall back to Web Speech recognition if available, otherwise typing |
| Access token expired | Mint a new one just before each socket open |
| Agent socket drops | Existing auto-reconnect. Unrevealed shapes from the lost step are discarded on rejoin |
| Tutor hears itself through speakers | Echo cancellation, raised VAD threshold while speaking (exists), "headphones recommended" hint, push-to-talk |
| Student starts talking just as a Practice remark is due | The yield check drops it |
| Long silence in Practice | One hint offer, then quiet |
| "Check" on an empty board | Says there's nothing yet and suggests a first shape |
| Two students talking | Each browser transcribes its own mic, and timeline lines carry the speaker's name |
| Tool call fails | The model sees the error (exists) |
| Driver leaves mid-step | The next participant becomes driver (exists). Staged shapes left by the old driver are discarded |
| Cost abuse on a public link | Per-IP rate limits on token minting and turns, a maximum session length |

## 11. Accessibility, privacy, responsible use

Accessibility:

- Live captions for both sides, with the tutor's current word highlighted (from timestamps).
- Everything works by keyboard and typing.
- Speech speed control (0.8×, 1.0×, 1.2× through `generation_config.speed`).
- A "describe the board" voice command: the tutor reads out the diagram's structure, for low-vision users.
- Feedback marks carry a text label, not only red or green.
- `prefers-reduced-motion` skips reveal fades.

Privacy:

- A consent sheet the first time the mic turns on: audio goes to Cartesia for transcription. Transcripts and board snapshots go to xAI for reasoning. The app stores no audio.
- Transcripts live in memory and are cleared when the room empties.
- A visible mic state at all times, plus push-to-talk.
- Check Cartesia's data retention terms before stating anything about them in the README.

Responsible use:

- The tutor is labeled AI and its voice is synthetic.
- No voice cloning.
- Practice gives a hint before the answer.
- The tutor stays on technical teaching topics.
- Rate limits and short-lived, STT-only tokens.

## 12. Config and secrets

`.env.example` (placeholders only, never real keys):

```
CARTESIA_API_KEY=
CARTESIA_VOICE_ID=
CARTESIA_TTS_MODEL=sonic-3
CARTESIA_STT_MODEL=ink-whisper
CARTESIA_VERSION=2026-03-01
XAI_API_KEY=
XAI_MODEL=grok-4.7            # today's file says grok-4; fix it
XAI_GATE_MODEL=grok-4.20-non-reasoning
PAUSE_MS=1500
```

`.env` is already in `.gitignore`. Never log keys or tokens.

**Running in a Claude Code cloud session:**

- **Network access.** The network policy blocked `api.cartesia.ai` and `docs.cartesia.ai`. Add both under Allowed domains in the environment's network settings, and add `CARTESIA_API_KEY` as an environment secret.
- **xAI key.** xAI is injected by the proxy. Set `XAI_API_KEY` to any placeholder and start the server with `NODE_USE_ENV_PROXY=1`, so Node's fetch uses the proxy.
- **WebSockets.** A WebSocket upgrade to `api.x.ai` through that proxy failed (HTTP 400), so Cartesia WebSockets may fail there too. Build against a fake Cartesia server (§14) and test live on a laptop. If needed, check whether Cartesia's `/tts/sse` endpoint supports timestamps **(verify)** as an HTTP fallback.

## 13. Build plan

Each phase ends with something that runs.

**Phase 0: spike (45 min).**
- Get network access and the key in place.
- Write a scratch script that answers the §18 questions: timestamps with continuations, PCM format, STT finalize latency, the token query parameter.
- Write the answers into §18.

**Phase 1: Cartesia voice (about 3 h).**
- `cartesia.ts`, relay, player, `listen.ts` with token, barge-in cancel, fallback banner.
- Remove xAI voice and Live voice.
- *Exit:* the Learn flow works by voice, end to end, on Cartesia.

**Phase 2: draw on the word (about 3 h).**
- Markers, staging and reveal, alignment, lookahead, karaoke captions, interruption truncation.
- *Exit:* boxes appear on their words. Interrupting removes unshown shapes and the tutor knows what was heard.

**Phase 3: Practice (3–4 h).**
- Timeline, binding mirror, pause gate, nudges, direct address, yield check, `start_practice` and `finish_practice`, task card and checklist.
- *Exit:* the full demo flow in §16 works.

**Phase 4: polish and responsibility (about 2 h).**
- Consent sheet, push-to-talk, speed control, describe-board, rate limits, the §20 fixes, the debug timing overlay, README.
- Rehearse and record a backup video.

**Cut lines if behind**, in this order:
1. Replace the gate model with rules: speak only when addressed, on "done", or once per 8 s pause.
2. Drop karaoke captions; show plain captions.
3. Drop describe-board.

Never cut: the reveal-on-word in Learn, barge-in, and the fallback.

## 14. Testing

- **Unit tests** (`server/test/`):
  - Marker parsing and word alignment, including normalized numbers and respellings.
  - Lookahead ordering.
  - Practice gate timing, cooldown and yield, with fake timers.
  - The guard covering every creating tool (§20).
- **Fake Cartesia** (`e2e/fake-cartesia.mjs`, modeled on `e2e/fake-realtime.mjs`): accepts TTS contexts and returns silent PCM16 with evenly spaced word timestamps. Accepts STT audio and returns a scripted transcript on `finalize`.
- **E2E against the fake:**
  - Shapes reveal in marker order, near their word times.
  - Barge-in discards staged shapes.
  - Practice stays silent through think-aloud lines and speaks once after a pause.
  - `done` produces a checklist.
- **Live scripts:** adapt `e2e/voice.mjs` (fake mic using `e2e/question.wav`) to report the §15 numbers against real Cartesia.

## 15. Latency targets and instrumentation

| Measure | Target |
| --- | --- |
| End of student speech → first tutor audio (ack) | < 300 ms |
| End of student speech → first explanatory word | < 2 s |
| Marker word start → shape visible | < 150 ms |
| Student starts talking → tutor audio stops | < 200 ms |
| Practice pause → spoken remark starts | < 2.5 s |
| Gap between steps in a lesson | < 400 ms |

Log each one per turn, and show the last turn's numbers in a debug overlay (toggle with `?debug=1`). Judges respond to measured numbers.

## 16. Demo script (2 minutes, demo first)

1. **0:00–0:25 Learn.** By voice: "Teach me how a URL shortener scales." Shapes appear exactly on their words, and the caption highlights the word being spoken.
2. **0:25–0:40 Interrupt.** "Wait, why a cache?" The voice stops at once and the tutor answers. Shapes it hadn't shown yet are gone.
3. **0:40–1:15 Practice.** "Your turn: add the write path" (`start_practice`; the task card appears).
   - You draw and think aloud, and the tutor stays quiet.
   - You pause. "Nice. Where does the short code come from?" The circle lands on "code".
   - You add a counter and say "done". A spoken review plus a ✓/✗ checklist.
4. **1:15–1:35 Problem.** Technical ideas are visual and verbal. Videos can't hear you, chatbots can't see your sketch, and tutors are expensive.
5. **1:35–2:00 How it's built.** The §5 diagram with the Cartesia pieces named (Sonic WebSocket with continuations and timestamps, streaming STT with tokens, cancel), plus two measured numbers from §15.

Use headphones. Keep mock mode and the recorded video ready.

## 17. README checklist (submission)

- [ ] One-paragraph pitch and the demo video link
- [ ] Setup: Node version, `npm install`, `.env` from `.env.example`, `npm run dev`
- [ ] **Cartesia features used:** the §4 table with file paths
- [ ] Other tools: Grok, tldraw
- [ ] Privacy and responsible use: §11, in short
- [ ] Known limitations:
  - English only
  - headphones recommended
  - only the person at the mic is heard by the tutor
  - no accounts
  - current board page only
  - the fallback voice has no word sync
- [ ] Tests: how to run unit, fake-Cartesia e2e, and live scripts
- [ ] No keys in the repo (spot-check `git log -p` for secrets before submitting)

## 18. Open questions (answer in Phase 0)

1. TTS model ID and API version (`sonic-3` vs `sonic-3.5` / `sonic-latest`). Does `generation_config.speed` work on the chosen model?
2. With continuations, are timestamps relative to the context start or to each input? Do they arrive before or with the matching audio?
3. WebSocket output formats and sample rates. Is raw `pcm_s16le` at 24 kHz available?
4. STT: `ink-whisper` vs `ink-2` latency, the exact `finalize` and `close` messages, and whether the turns endpoint (`/stt/turns/websocket`) gives useful end-of-turn detection.
5. The access token request shape (grants, expiry), and how a browser passes it on a WebSocket.
6. Custom pronunciation support and syntax on the chosen model.
7. Cartesia's data retention terms, for the README.
8. The TTS WebSocket idle timeout and keepalive.

## 19. Alternative: run the agent on Cartesia Line

Line is Cartesia's voice agent platform. Known from the docs:

- You write the agent in Python (`cartesia-line`) and deploy it with `cartesia deploy`.
- `LlmAgent` connects to 100+ LLM providers through LiteLLM, so you bring your own model.
- Client tools send `client_tool_call` to the browser over the Agents WebSocket (`wss://api.cartesia.ai/agents/stream/{agent_id}`). The browser answers with `client_tool_result`, and `expects_response` controls whether the agent waits.
- The browser can send a `custom` event with metadata, which the agent receives as an input event.

That would hand turn-taking and interruptions to Cartesia, which is a strong story. Switch to it only if a 60–90 minute spike shows all of these:

1. The browser gets the agent's spoken words with timing, or tool calls arrive before the matching audio. Without one of those, drawing can't land on the word.
2. The agent can stay silent after a think-aloud utterance.
3. A `custom` "student drew X" event can trigger a spoken turn.
4. Board images can reach the model, or a `look_at_board` tool can return a text description instead.

If any check fails, stay with §5. Either way, the browser executor, the staged shapes and the Practice rules carry over.

## 20. Carry-over fixes from the review

1. **The guard misses most creating tools.** It only checks `create_shape`, `update_shape` and `clear_canvas` (`server/src/agent.ts` `guard`). `suggest_correction` creates shapes in the browser with ids the model picks (`executor.ts` `suggest_correction`). If the model reuses a student's id, the student's shape is overwritten and tagged as a suggestion, and **Dismiss** then deletes it. `highlight_shapes`, `add_comment` and `create_arrow` also delete any existing shape with their id. Fix: in the executor, refuse or rename any id that belongs to a non-agent shape for every creating tool, and add a unit test.
2. **The suggestion label overlaps the agent's sticky note.** It's placed at `b.maxY + 16` without a free-space check (`executor.ts`). Run it through `findFreeSpot`.
3. **Unprotected endpoints.** Every `/api/*` route is open. Add per-IP rate limits before sharing a public link.
4. **`.env.example` sets `XAI_MODEL=grok-4`**, which overrides the tuned `grok-4.7` default.
5. **The tldraw "Get a license for production" badge** shows in every screenshot. Get a license key before recording.

## 21. References

- [TTS WebSocket](https://docs.cartesia.ai/api-reference/tts/websocket) and [handling responses](https://docs.cartesia.ai/examples/tts-websocket-response-handling)
- [Compare TTS endpoints](https://docs.cartesia.ai/use-the-api/compare-tts-endpoints.md)
- [Sonic 3](https://docs.cartesia.ai/build-with-cartesia/sonic-3) and [volume, speed, emotion](https://docs.cartesia.ai/build-with-cartesia/sonic-3/volume-speed-emotion)
- [STT WebSocket](https://docs.cartesia.ai/api-reference/stt/websocket) and the [manual finalize example](https://docs.cartesia.ai/examples/stt-manual-finalize-websocket)
- [Migrating from Deepgram](https://docs.cartesia.ai/use-the-api/stt/migrate-from-deepgram-nova/manual) (STT parameters, `ink-2` caveats)
- [Authenticate client apps](https://docs.cartesia.ai/get-started/authenticate-your-client-applications) and the [access token API](https://docs.cartesia.ai/api-reference/auth/access-token.md)
- [Line introduction](https://docs.cartesia.ai/line/introduction), [Line SDK](https://docs.cartesia.ai/line/sdk/overview.md), [events](https://docs.cartesia.ai/line/sdk/events)
- [Agents WebSocket](https://docs.cartesia.ai/api-reference/agents/websocket.md) and [client tools](https://docs.cartesia.ai/agents/client-tools)
- Full docs index: https://docs.cartesia.ai/llms.txt
