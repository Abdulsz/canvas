# Technical Specification: Real-Time AI Interactive Teaching Whiteboard

## 1. Project Overview & Objective
Build a web application that functions as an interactive, voice-driven AI teacher on a **shared, multiplayer canvas**. The agent will verbally explain complex topics—including System Design architectures, Data Structures & Algorithms (LeetCode), and technical concepts—while simultaneously drawing diagrams, code structures, and flowcharts on an interactive **tldraw** canvas in real time.

The whiteboard is **two-way and collaborative**:
* **Multiple users** can join the same board and draw, write, and move shapes together in real time, alongside the agent.
* **Users can draw too**, not only the agent. Students can sketch their own architecture, trace an algorithm, or fill in a diagram the agent started.
* **The agent can see the canvas.** It reads what users have drawn (both structured shape data and a rendered image), checks it for correctness, and responds by voice and with annotations on the board (e.g., "Your load balancer is missing a health check. I've circled it in red.").

The system utilizes **xAI Grok models** for intelligence, vision, and voice processing.

---

## 2. Core Architecture & Tech Stack

```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│        Client (User A)       │   │        Client (User B)       │
│  ┌────────────┐ ┌─────────┐  │   │  ┌────────────┐ ┌─────────┐  │
│  │  tldraw    │ │  Voice  │  │   │  │  tldraw    │ │  Voice  │  │
│  │  Canvas    │ │  Loop   │  │   │  │  Canvas    │ │  Loop   │  │
│  └─────▲──────┘ └────▲────┘  │   │  └─────▲──────┘ └────▲────┘  │
└────────│─────────────│───────┘   └────────│─────────────│───────┘
         │ sync + presence (WebSocket)      │             │ audio
         │             │                    │             │
┌────────┴─────────────┴────────────────────┴─────────────┴───────┐
│                    Node.js Orchestration Server                 │
│                                                                 │
│  • Room / Sync Server (tldraw sync: authoritative doc per room) │
│  • Presence (cursors, names, colors; agent has its own cursor)  │
│  • Canvas Observer (diffs user edits, debounces, builds context)│
│  • Canvas State Manager (Grok tool calls -> tldraw mutations)   │
│  • Canvas Reader (shape JSON + PNG snapshot for vision)         │
│  • System Prompt & Session Context Manager                      │
│  • Grok API Client (tools, vision, voice)                       │
└──────────────────────────────▲──────────────────────────────────┘
                               │ API Calls
                 ┌─────────────┴────────────┐
                 │    xAI Grok API Suite    │
                 │  (text/tools, vision,    │
                 │   voice)                 │
                 └──────────────────────────┘
```

* **Frontend:** React, TypeScript, Next.js or Vite, Tailwind CSS.
* **Canvas Engine:** `tldraw` (open-source infinite canvas).
* **Multiplayer Sync:** `@tldraw/sync` (`useSync` on the client, `TLSocketRoom` on the server). It keeps one authoritative document per room, so every user and the agent see the same canvas. (Alternative: Yjs + `y-websocket` if self-hosting the sync layer is preferred.)
* **Presence:** tldraw's built-in multiplayer presence shows live cursors, user names, and colors. The agent joins as a named participant ("Professor Grok") with its own cursor so users can see where it is drawing.
* **AI Model & Voice Provider:** xAI Grok API (structured tool calling, **vision** for reading the canvas, and voice/speech).
* **Agent as a participant:** The server applies the agent's tool calls to the room document **as a regular sync client**, so they fan out to every connected user like any other edit, and user edits flow back to the agent the same way.

---

## 3. Key Features

1. **Simultaneous Speech & Canvas Drawing:** As Grok speaks explanations, it executes canvas tool calls step-by-step so visual elements appear synchronized with the voice.
2. **Real-Time Multiplayer Collaboration:**
   * Several users share one board (a "room"/session link). All edits sync live.
   * Live cursors and name tags for each user and for the agent.
   * Every shape records who made it (`meta.author = { kind: "user" | "agent", id, name }`) and when (`meta.createdAt`, `meta.updatedAt`), so the agent knows what is the student's work and what is its own.
3. **User Drawing & Agent Review ("Check my work"):**
   * Users draw freely with all tldraw tools (shapes, arrows, freehand pen, text, sticky notes).
   * The agent reads the board through two channels:
     * **Structured state:** shape list with types, positions, labels, arrow bindings (what connects to what), and authorship. This is good for diagrams and arrays.
     * **Visual snapshot:** a PNG export of the board or region, sent to Grok vision. This is needed for **freehand ink**, handwriting, and rough sketches that have no semantic labels.
   * The agent gives feedback by voice **and** on the canvas: it highlights or circles mistakes, adds comment callouts, draws suggested corrections in a distinct color next to the user's drawing, or confirms correct work with a green check.
4. **Review Triggers (configurable per session):**
   * **On request (default):** a user says "check this" / "is this right?" or clicks a **"Check my work"** button (optionally after selecting shapes to scope the review).
   * **Proactive:** after a user stops drawing for N seconds (debounced, e.g. 3–5s), the agent looks at the changes and may comment briefly. It stays quiet if nothing notable happened.
   * **Exercise mode:** the agent sets a task ("Draw the URL shortener's write path", "Show the pointers after step 3"), waits for the user, then grades it.
5. **Interactive Teaching Tool Set:**
   * **System Design Mode:** Nodes (services, databases, load balancers), labeled arrows (data flow), boundaries (VPCs, clusters), and sticky notes. Users can extend the agent's diagram and the agent critiques the additions.
   * **Algorithms & LeetCode Mode:** Array/Grid visualizations, tree and graph nodes, pointers ($i$, $j$, $left$, $right$), step-by-step state highlights. Users can move pointers or write values, and the agent verifies each step.
   * **General Conceptual Mode:** Mind maps, bulleted sticky notes, callout boxes, and hand-drawn annotations.
6. **Canvas Control Actions:** Clear board, move focus/viewport to active element, highlight shapes, erase elements, and organize layouts.
7. **Collaboration Etiquette for the Agent:**
   * The agent **never deletes or rewrites user-authored shapes** unless a user explicitly asks. It annotates beside them instead.
   * The agent avoids drawing on top of a region a user is actively editing (it uses presence/cursor data to pick free space).
   * In multi-user rooms, the agent addresses users by name when giving feedback on their specific shapes.

---

## 4. Grok Tool Definitions (Function Schema)

The model must be provided with structured function definitions so it can issue precise drawing commands **and read the shared canvas**.

### 4.1 Drawing Tools

```json
[
  {
    "name": "create_shape",
    "description": "Creates a visual element on the whiteboard canvas (boxes, circles, text, sticky notes).",
    "parameters": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "description": "Unique semantic shape ID (e.g., 'db_main', 'node_root')" },
        "type": { "type": "string", "enum": ["geo", "text", "note"] },
        "geo": { "type": "string", "enum": ["rectangle", "ellipse", "diamond"], "description": "Shape geometry if type is geo" },
        "x": { "type": "number", "description": "Canvas X position" },
        "y": { "type": "number", "description": "Canvas Y position" },
        "w": { "type": "number", "description": "Width" },
        "h": { "type": "number", "description": "Height" },
        "label": { "type": "string", "description": "Text content inside or on the shape" },
        "color": { "type": "string", "enum": ["black", "blue", "green", "red", "orange", "grey"] }
      },
      "required": ["id", "type", "x", "y", "label"]
    }
  },
  {
    "name": "create_arrow",
    "description": "Draws a directed connection arrow between two shapes or coordinates.",
    "parameters": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "fromId": { "type": "string", "description": "Start shape ID" },
        "toId": { "type": "string", "description": "Target shape ID" },
        "label": { "type": "string", "description": "Optional connection label (e.g., 'gRPC', 'HTTP')" },
        "color": { "type": "string" }
      },
      "required": ["id", "fromId", "toId"]
    }
  },
  {
    "name": "draw_array",
    "description": "Renders an array data structure on the whiteboard with indices and pointer markers.",
    "parameters": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "startX": { "type": "number" },
        "startY": { "type": "number" },
        "values": { "type": "array", "items": { "type": "string" }, "description": "Array elements" },
        "pointers": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "index": { "type": "integer" },
              "label": { "type": "string", "description": "e.g. 'left', 'right', 'mid'" }
            }
          }
        }
      },
      "required": ["id", "startX", "startY", "values"]
    }
  },
  {
    "name": "update_shape",
    "description": "Modifies an existing agent-authored shape (move, relabel, recolor). Use to move pointers between algorithm steps. Must not be used on user-authored shapes unless a user asked for it.",
    "parameters": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "x": { "type": "number" },
        "y": { "type": "number" },
        "label": { "type": "string" },
        "color": { "type": "string", "enum": ["black", "blue", "green", "red", "orange", "grey"] }
      },
      "required": ["id"]
    }
  },
  {
    "name": "focus_view",
    "description": "Pan or zoom the canvas viewport to focus attention on specific shapes. In multi-user rooms, 'scope' controls whether everyone's view moves or only the requesting user's.",
    "parameters": {
      "type": "object",
      "properties": {
        "shapeIds": { "type": "array", "items": { "type": "string" } },
        "zoomLevel": { "type": "number", "default": 1.0 },
        "scope": { "type": "string", "enum": ["requester", "everyone"], "default": "requester" }
      },
      "required": ["shapeIds"]
    }
  },
  {
    "name": "clear_canvas",
    "description": "Clears all elements or a section from the whiteboard. Clearing user-authored shapes requires explicit user confirmation.",
    "parameters": {
      "type": "object",
      "properties": {
        "mode": { "type": "string", "enum": ["all", "selection", "agent_only"] },
        "ids": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["mode"]
    }
  }
]
```

### 4.2 Canvas Reading Tools (the agent "sees" the board)

```json
[
  {
    "name": "get_canvas_state",
    "description": "Returns a structured description of shapes on the canvas: id, type, geometry, bounds, label/text, color, arrow bindings (fromId/toId), and author. Use this to understand diagrams and arrays users have drawn.",
    "parameters": {
      "type": "object",
      "properties": {
        "region": {
          "type": "object",
          "description": "Optional page-space bounding box to limit results",
          "properties": { "x": { "type": "number" }, "y": { "type": "number" }, "w": { "type": "number" }, "h": { "type": "number" } }
        },
        "shapeIds": { "type": "array", "items": { "type": "string" }, "description": "Optional explicit shapes to return" },
        "author": { "type": "string", "enum": ["any", "user", "agent"], "default": "any" }
      }
    }
  },
  {
    "name": "get_canvas_image",
    "description": "Renders the canvas (or a region / set of shapes) to a PNG and returns it for visual inspection. Required for freehand drawings, handwriting, and sketches without labels.",
    "parameters": {
      "type": "object",
      "properties": {
        "shapeIds": { "type": "array", "items": { "type": "string" } },
        "region": {
          "type": "object",
          "properties": { "x": { "type": "number" }, "y": { "type": "number" }, "w": { "type": "number" }, "h": { "type": "number" } }
        },
        "scale": { "type": "number", "default": 1.0 }
      }
    }
  },
  {
    "name": "get_recent_changes",
    "description": "Returns shapes created, updated, or deleted by users since the agent last looked (or since a given timestamp), grouped by user.",
    "parameters": {
      "type": "object",
      "properties": {
        "since": { "type": "string", "description": "ISO timestamp; defaults to the agent's last review" }
      }
    }
  },
  {
    "name": "get_participants",
    "description": "Lists connected users with name, color, cursor position, current selection, and whether they are actively drawing.",
    "parameters": { "type": "object", "properties": {} }
  }
]
```

### 4.3 Feedback & Annotation Tools

```json
[
  {
    "name": "highlight_shapes",
    "description": "Draws a colored outline / circle around shapes to point at them (e.g., red for an error, green for correct). Non-destructive: the shapes themselves are not changed.",
    "parameters": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "shapeIds": { "type": "array", "items": { "type": "string" } },
        "style": { "type": "string", "enum": ["circle", "outline", "underline"], "default": "outline" },
        "color": { "type": "string", "enum": ["red", "green", "orange", "blue"] }
      },
      "required": ["id", "shapeIds", "color"]
    }
  },
  {
    "name": "add_comment",
    "description": "Places a callout/sticky note next to a shape or region with feedback text, connected by a short leader arrow.",
    "parameters": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "targetShapeId": { "type": "string" },
        "text": { "type": "string" },
        "kind": { "type": "string", "enum": ["error", "hint", "praise", "question"] },
        "addressedTo": { "type": "string", "description": "Optional participant id/name the comment is for" }
      },
      "required": ["id", "text", "kind"]
    }
  },
  {
    "name": "suggest_correction",
    "description": "Draws a proposed fix as a ghosted/dashed overlay in a distinct color next to the user's work, without modifying it. Users can accept (convert to solid) or dismiss it.",
    "parameters": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "forShapeIds": { "type": "array", "items": { "type": "string" } },
        "shapes": { "type": "array", "description": "Shapes/arrows to draw, using the create_shape / create_arrow argument format", "items": { "type": "object" } },
        "explanation": { "type": "string" }
      },
      "required": ["id", "shapes"]
    }
  }
]
```

---

## 5. Canvas Observation Pipeline (How the Agent Sees User Drawings)

1. **Change capture:** The server's sync room listens to document changes (`TLSocketRoom` change events, or `editor.store.listen` with `source: 'user'` on a headless editor). Each change is tagged with the author from the connection's session identity.
2. **Debounce & batch:** Edits are buffered per user until they pause (default 3s idle, or pen-up for freehand) so the agent is not woken on every stroke.
3. **Context building:** For a review, the server assembles:
   * A compact text summary from `get_canvas_state` (labels, connections, arrays, authorship), trimmed to the relevant region.
   * A PNG of the changed region (`editor.toImage(shapeIds, { format: 'png', background: true })`), included as an image input to Grok vision when freehand/draw shapes or unlabeled sketches are present.
   * The current lesson context: topic, active exercise, and what the agent has already said.
4. **Decide & respond:** Grok decides whether to speak, annotate, both, or stay silent (in proactive mode). Responses go back through the normal tool-call → canvas mutation path and voice stream.
5. **Turn-taking:** While the agent is speaking/drawing, user edits continue to sync normally. The agent finishes its current step, then reads any new changes before its next step, so it never draws over stale assumptions. A user speaking interrupts the agent's voice output (barge-in).

---

## 6. System Prompt Strategy

Use the following system prompt for the Grok agent:

```text
You are an expert technical professor and system designer conducting interactive, collaborative whiteboard sessions.
You explain concepts verbally using xAI Grok voice while actively drawing on a shared tldraw canvas via tool calls.
One or more students share the board with you. They can draw too, and you can see what they draw.

TEACHING RULES:
1. DRAW WHILE YOU SPEAK: Never give a long verbal explanation without illustrating it. Break down explanations into logical drawing steps.
2. SYSTEM DESIGN INSTRUCTIONS:
   - Use clear boxes for microservices, gateways, and workers.
   - Use cylinders/diamonds for databases, caches, and queues.
   - Draw labeled arrows showing request flows, network protocols, and data directions.
3. LEETCODE & ALGORITHM INSTRUCTIONS:
   - Use `draw_array` or custom node grids to illustrate array mutations, sorting steps, or two-pointer logic.
   - Move pointer labels explicitly on each algorithm iteration.
4. CANVAS MANAGEMENT:
   - Space shapes cleanly (avoid overlapping elements, including students' drawings).
   - Use color coding (e.g., Red for bottlenecks/errors, Green for success paths, Blue for main components).
   - Call `focus_view` when shifting focus to a new section of a large diagram.

COLLABORATION RULES:
5. LOOK BEFORE YOU RESPOND: When a student asks you to check their work, or you are told the board changed,
   call `get_recent_changes` / `get_canvas_state` first. If the drawing is freehand, handwritten, or unlabeled,
   also call `get_canvas_image` and inspect it visually. Never guess what is on the board.
6. GIVE FEEDBACK ON THE BOARD: Point at specific shapes with `highlight_shapes`, explain with `add_comment`,
   and show fixes with `suggest_correction`. Pair every visual annotation with a short spoken explanation.
7. RESPECT STUDENT WORK: Never delete, move, or relabel shapes authored by a student unless they ask you to.
   Annotate next to their work instead.
8. TEACH, DON'T JUST CORRECT: Prefer a hint or a guiding question before revealing the full answer.
   Praise what is correct before pointing out what is wrong.
9. MULTIPLE STUDENTS: Address students by name when commenting on their shapes. Don't draw where someone is
   actively working (check `get_participants`).
10. PROACTIVE MODE: If you were woken by an idle-after-edit event and nothing important is wrong or missing,
    stay silent or give at most one brief encouraging remark.
```

---

## 7. Implementation Steps for the Developer Agent

1. **Initialize Frontend Repository:** Set up Next.js (or Vite) with Tailwind CSS and install `tldraw` and `@tldraw/sync`.
2. **Set up the Multiplayer Sync Server:** In the Node.js server, create a `TLSocketRoom` per session/room ID, expose a WebSocket endpoint (`/connect/:roomId`), and persist room snapshots (SQLite/Postgres/blob storage) so boards survive reconnects. Add an asset upload endpoint for images.
3. **Set up the tldraw Canvas Component:** Mount `<Tldraw store={useSync({ uri, assets, userInfo })} />` so every client joins the shared room, with each user's name and color for presence. Acquire the `editor` instance via `onMount`.
4. **Attach Authorship Metadata:** Use a side-effect handler (`editor.sideEffects.registerBeforeCreateHandler('shape', ...)`) on clients to stamp `meta.author`, `meta.createdAt`, and `meta.updatedAt` on every user-created shape. The agent stamps `kind: "agent"` on its own shapes.
5. **Connect the Agent as a Room Participant:** Run a headless/server-side sync client for the agent that applies tool calls to the room document (so edits broadcast to all users) and publishes an agent presence record (name, color, cursor that moves to where it is drawing).
6. **Bridge Tool Calls to the tldraw Engine:** Map incoming JSON function call payloads from Grok to `editor.createShapes()`, `editor.updateShapes()`, `editor.deleteShapes()`, and `editor.zoomToBounds()`. Enforce the "no edits to user-authored shapes" rule server-side, not only in the prompt.
7. **Implement Canvas Reading:** Build `get_canvas_state` (serialize shapes and resolve arrow bindings to `fromId`/`toId`), `get_canvas_image` (`editor.toImage` → base64 PNG for Grok vision), `get_recent_changes` (change log keyed by author and timestamp), and `get_participants` (from presence records).
8. **Implement the Observation Pipeline:** Change listener → per-user debounce → context builder → Grok call (Section 5). Add a **"Check my work"** button that triggers a review scoped to the current selection, and a session setting for review mode (on-request / proactive / exercise).
9. **Implement Feedback Tools:** `highlight_shapes`, `add_comment`, and `suggest_correction` (dashed, semi-transparent shapes in a reserved color, tagged `meta.suggestion = true`, with Accept/Dismiss buttons in the UI).
10. **Set up xAI Grok Audio/Voice Integration:**
    * Implement voice streaming over a WebSocket connection.
    * Send user voice audio input to Grok (with the speaker's identity in multi-user rooms).
    * Receive streaming audio output while parsing interspersed JSON function calls in real time.
    * Support barge-in: user speech interrupts agent audio.
11. **Layout Engine Helper:** Build basic layout positioning logic (e.g., auto-calculate $X, Y$ coordinates for grid, array, or tree layouts) that also **avoids occupied regions**, including user drawings and areas near active user cursors.

---

## 8. Acceptance Criteria (Collaboration)

* Two browsers on the same room link see each other's edits and cursors within ~200ms, and both see the agent's drawings.
* A user draws a box labeled "Cache" with an arrow to "DB" and clicks "Check my work". The agent correctly describes what was drawn and responds by voice plus at least one on-canvas annotation.
* A user draws a freehand (pen) sketch with no labels. The agent uses the image snapshot and describes the sketch accurately.
* The agent never modifies or deletes a user-authored shape without an explicit request (verified by server-side guard tests).
* In proactive mode, the agent does not respond more than once per idle period and stays silent on trivial edits.
