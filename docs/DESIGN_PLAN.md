# Pivot plan: voice-driven UI / wireframe design tool

The app goes from "Professor Grok teaches on a whiteboard" to **"Grok Design": a
Figma-like canvas where you design app screens and wireframes by talking**. The
voice pipeline, sync, agent loop, authorship and review plumbing all stay. What
changes is the domain: shapes, tools, prompt, mock agent and app shell.

The model is borrowed from Figma's document model (see `@figma/plugin-typings`):
screens are top-level frames, frames nest and use auto layout
(`layoutMode`, `itemSpacing`, `padding*`, `primaryAxisAlignItems`,
`counterAxisAlignItems`, `layoutSizing* = FIXED | HUG | FILL`), colors come
from variables with light/dark modes.

## 1. One custom tldraw shape: `ui`

Every design element is a `ui` shape (type `'ui'`). Registered on the client
(`client/src/design/UiShapeUtil.tsx`) and on the server schema
(`server/src/rooms.ts`, via `createTLSchema({ shapes: { ...defaultShapeSchemas, ui: {...} } })`).
Props validators + defaults live in `shared/design.ts` so both sides agree.

Props (all required in the record; defaults fill them in):

| prop | type | notes |
| --- | --- | --- |
| `w`, `h` | number | size in page units |
| `kind` | string | `screen` `frame` `text` `button` `input` `image` `icon` `avatar` `toggle` `checkbox` `divider` `rect` |
| `name` | string | layer name (Layers panel) |
| `text` | string | text / button label / input placeholder / checkbox label |
| `icon` | string | icon name for `icon`/`button`/`input` (small built-in set, e.g. `search` `user` `home` `settings` `bell` `heart` `star` `plus` `menu` `arrow-left` `arrow-right` `check` `x` `mail` `lock` `cart` `chat` `calendar` `image`) |
| `fill` | string | hex (`#ff0000`), `transparent`, or a token (`$bg` `$surface` `$surfaceAlt` `$primary` `$onPrimary` `$text` `$muted` `$border`) |
| `textColor` | string | same format |
| `stroke` | string | same format, `transparent` = none |
| `strokeWidth` | number | |
| `radius` | number | corner radius (avatar: ignored, always round) |
| `fontSize` | number | |
| `fontWeight` | number | 400/500/600/700 |
| `align` | string | `left` `center` `right` (text alignment) |
| `shadow` | string | `none` `sm` `md` `lg` |
| `opacity` | number | 0..1 |
| `checked` | boolean | toggle / checkbox state |

Layout lives in `meta` (no schema migration needed when it evolves):

```ts
meta.layout = { mode: 'vertical' | 'horizontal' | 'none', gap: number,
                padding: [top, right, bottom, left],
                alignItems: 'start' | 'center' | 'end' | 'stretch',
                justify: 'start' | 'center' | 'end' | 'space-between' }   // screen + frame only
meta.sizing = { w: 'fixed' | 'fill' | 'hug', h: 'fixed' | 'fill' | 'hug' }
meta.order  = number   // index among siblings for auto layout
meta.theme  = { mode: 'light' | 'dark', primary: '#hex' }        // screen only
meta.author / meta.updatedBy                                      // unchanged
```

Children are real tldraw children (`parentId` = container shape id), positioned
relative to the parent. `screen` and `frame` clip their children
(`getClipPath`) and accept new children (`canReceiveNewChildrenOfType`). A
`screen` draws its name above its top-left corner, like a Figma frame label.

### Tokens (variables with modes)

`shared/design.ts` exports `THEMES.light` / `THEMES.dark` (token -> hex) and
`resolveColor(value, theme)`. The renderer resolves `$tokens` against the
nearest `screen` ancestor's `meta.theme` (default light, primary `#5b5bd6`).
So "switch to dark mode" is one `set_theme` call.

### Auto layout engine (`shared/design.ts`, pure, unit tested)

`layoutTree(node)` takes a plain tree `{ id, kind, w, h, text, fontSize, sizing, layout, children }`
and returns `Map<id, {x, y, w, h}>` (x/y relative to parent). Rules (Figma's):
- `hug`: container = children + gaps + padding; text = measured (estimate:
  `0.55 * fontSize` per char, line height `1.4 * fontSize`, wrapping when width is fixed/fill).
- `fill`: takes the remaining space on the primary axis (split equally among fill
  siblings) or the full inner size on the cross axis.
- `alignItems` positions on the cross axis (`stretch` = fill cross axis); `justify` on the primary axis.
- `mode: 'none'`: children keep their own x/y.
The executor calls it after every structural edit, on the affected screen.

### Kind defaults (component presets)

`KIND_DEFAULTS` in `shared/design.ts`, e.g. button: h 48, w hug (padding 24),
fill `$primary`, textColor `$onPrimary`, radius 10, fontWeight 600; input: h 48,
w fill, fill `$surface`, stroke `$border`, textColor `$muted`, radius 10;
text: hug, `$text`, 16; frame: vertical, gap 12, padding 0, transparent;
image: fill `$surfaceAlt`, w fill, h 160, radius 12; avatar 40x40; icon 24x24;
toggle 44x24; checkbox: hug, 20px box + label; divider: w fill, h 1, `$border`.
Device presets `DEVICES`: iphone 390x844, android 412x915, tablet 834x1194,
desktop 1440x1024, watch 198x242.

## 2. Agent tools (`shared/tools.ts`)

Node spec used by the tools (`UiNodeSpec`):

```ts
{ id: string; type: UiKind (not 'screen'); name?; text?; icon?;
  width?: number | 'fill' | 'hug'; height?: number | 'fill' | 'hug';
  fill?; textColor?; stroke?; strokeWidth?; radius?; fontSize?; fontWeight?;
  align?; shadow?; opacity?; checked?;
  layout?: 'vertical' | 'horizontal' | 'none'; gap?; padding?: number | number[];
  alignItems?; justify?; x?; y?;            // x/y only when the parent's layout is 'none'
  children?: UiNodeSpec[] }
```

Design tools (run in the browser by `CanvasExecutor`):
- `create_screen { id, name, device?, width?, height?, x?, y?, theme?: 'light'|'dark', primary?, fill?, layout?, gap?, padding?, alignItems?, justify?, children? }`
  Creates an artboard and its whole subtree in one call. Without x/y it is placed
  to the right of the existing screens (120px gap). Calling it again with an
  existing id replaces that screen's contents.
- `add_nodes { parentId, index?, nodes: UiNodeSpec[] }` insert subtrees into a screen/frame.
- `update_node { id, ...any UiNodeSpec prop except children }` edit props; re-layout.
- `move_node { id, parentId?, index? }` reorder or reparent.
- `delete_nodes { ids }`
- `duplicate_screen { id, newId, name? }`
- `set_theme { screenId | 'all', mode?: 'light'|'dark', primary? }`
- `connect_screens { id, fromId, toId, label? }` prototype flow arrow (from a node or screen to a screen).
- `focus_view`, `clear_canvas` (unchanged semantics; `agent_only` etc.).

Reading tools: `get_canvas_state` returns screens as nested trees
(`{id, type, name, text, w, h, x, y, fill, ..., children}`) plus other shapes flat;
`get_canvas_image`, `get_recent_changes`, `get_participants` unchanged.

Feedback tools (design critique): `highlight_shapes`, `add_comment` (kinds
`issue` `suggestion` `praise` `question`). `draw_array`, `create_shape`,
`suggest_correction` are removed.

## 3. Agent behaviour (`server/src/prompt.ts`)

Name: **Grok Design** (`AGENT_NAME`). A senior product designer pair-designing
by voice. Each step: one or two short spoken sentences + the tool calls for that
step. Starts by building fast (a sensible first draft beats questions), then
asks one focused question to steer the next iteration ("Want social login
too?"). Applies the user's spoken edits precisely, references elements by what
the user sees ("the blue button"), keeps a consistent 8px spacing scale, uses
tokens for colors, never touches user-authored nodes without asking (guard stays).
Review modes: `on_request` ("Critique"), `proactive`, and `guided` (replaces
`exercise`: the agent leads the session with questions, one decision at a time).

## 4. App shell (Figma-like)

- Left: **Layers** panel (screens -> nested nodes, select on click, hover highlight, rename).
- Right: **Design** panel for the selected `ui` node (fill/text/stroke colors,
  radius, font size/weight, W/H + sizing, auto-layout direction/gap/padding)
  and the agent panel (conversation + mic) as a second tab or stacked.
- Top bar: file name, **Insert** menu (screen presets by device, components),
  theme toggle, Invite, Export (PNG via tldraw, and **Copy code**: HTML/CSS
  generated from the selected screen's tree).
- Keep tldraw's canvas/tools; hide its style panel for `ui` shapes.

## 5. Mock agent (no API key)

Scripts that exercise every tool: "login screen", "dashboard", "landing page" /
"onboarding"; edits: "make the button <color>", "dark mode", "add a <component>",
"rename/change the title to X", "delete the X", "add another screen / connect";
critique on request. Unknown prompts -> generic screen built from the request words.
