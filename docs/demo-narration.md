# Demo video narration

Voice-over for the 89.5s product demo (`client/.clipmunk/exports/demo.mp4`, sequence `demo`). Timestamps are where each scene starts in the exported video. Read at a relaxed pace (about 130 words a minute); each line fits inside its scene with room to breathe. The on-screen captions carry the story on mute, so the narration can stay loose.

| Time | Scene | Narration |
| --- | --- | --- |
| 0:00–0:06 | Hook: the finished login and menu flow | "This is Grok Design. It's a tool I built where you design app screens just by talking." |
| 0:06–0:10 | Problem: the empty canvas | "Normally, mockups mean hours of clicking." |
| 0:10–0:25 | Turn 1: "Design a login screen for a coffee shop app" | "So I just say what I want. A skeleton shows up right away, and the real login screen lands about sixteen seconds later. I trimmed the wait, but the timer shows the real time." |
| 0:25–0:33 | Turn 2: "Make the sign in button brown" | "Edits are one sentence. That's a single tool call on the button." |
| 0:33–0:48 | Turn 3: "Add a menu screen and connect sign in to it" | "Now a menu screen. It streams in section by section, and Grok draws the flow arrow from sign in." |
| 0:48–0:57 | Turn 4: "Switch everything to dark mode" | "And one more sentence flips every screen to dark mode." |
| 0:57–1:04 | Pro tools: Layers and Design panels | "It's still a real design tool. I can pick the button in Layers and round its corners by hand." |
| 1:04–1:10 | Copy code | "Any screen exports as HTML and CSS." |
| 1:10–1:19 | Critique | "When I ask for a critique, Grok can only flag layout problems the app actually measured, and it pins its notes on the canvas." |
| 1:19–1:25 | Under the hood | "It's React, TypeScript and tldraw, with Grok tool calls driving my own auto-layout engine." |
| 1:25–1:29 | End card | "The code's on GitHub. Thanks for watching." |

About 165 words.

Notes for recording:

- Everything on screen is a real recorded session with Grok (fixtures in `client/src/clipmunk/fixtures/demo-session.json`), so the narration never claims more speed than the timer shows.
- In turn 2 the button was already the brand brown Grok picked for the app, so the line talks about the tool call, not a visible color change.
