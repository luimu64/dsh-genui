# dsh-genui

A DeepSeek Harness bundle that lets the assistant answer in **OpenUI Lang** — a declarative
UI language — and paints that answer as interface instead of markdown. It also gives the
answer two image side effects, `generate_image` and `edit_image`, backed by a ComfyUI you
already run.

The harness keeps everything it normally owns: chat streaming, sessions, settings, tools,
sandbox and approval policy. This bundle adds an answer *format*, the renderer that draws it,
and the ComfyUI plumbing behind the two image queries.

```text
user prompt
  -> DSH agent loop                        (identity, tools, approvals: unchanged)
     -> final assistant message in openui-lang
        -> session log stores the text
        -> dsh-genui shadows the assistant-step renderer (priority -1)
           -> OpenUI renderer parses the program
              -> Query("generate_image")
                 -> per-answer query provider
                    -> cache hit?  paint it
                    -> live turn?  POST /genui/generate
                       -> graph cloned from assets/, mutated, queued
                       -> ComfyUI /api/prompt -> /history -> /view
                       -> PNG saved under imagesDir
                    -> replayed turn with no cached render?  a hole + a retry button
              -> GenImage / GenImageSet paints the frame
```

## Requirements

- DeepSeek Harness `>=0.2.1-rc.5 <0.3.0`, with the web client.
- Node 24 (the official build; nothing native to compile).
- A reachable ComfyUI — by default `http://127.0.0.1:8188`.
- ComfyUI checkpoints matching the graphs in `assets/`. A default install needs the two
  `real` graphs only; the anime lane brings more, and is off unless you ask for it (see
  [Workflows](#workflows-what-is-on)). The graphs name specific files; if your ComfyUI has
  different ones, edit the templates or read [docs/graphs.md](docs/graphs.md) and point the
  registry at your own. Until then a render fails with ComfyUI's own "value not in list"
  error — the bundle itself still loads.
- Bun, for development only.

## Install

The bundle composes as one row, `dsh-genui`, configured from `cordis.patch.yml`.

```bash
# 1. a profile to install into (skip if you already have one)
dsh --profile genui --from-default-profile web --dump-config >/dev/null

# 2. link this checkout into it
dsh plugin --profile genui add .

# 3. confirm the row and its config arrived
dsh --profile genui --dump-config | sed -n '/dsh-genui/,+8p'
```

```bash
# 4. boot it
dsh --profile genui --no-open --port 3081

# 5. from another shell
curl -fsS http://127.0.0.1:3081/genui/health     # {"comfy":true,"workflows":["real"]}
```

`lib/` is committed, so installing from a checkout needs no build step. The `/genui/*` routes
404 until the bundle row activates; if that happens, look for a `dsh-genui` load error in the
harness log before suspecting the client.

## Configuration

Resolved by `src/host/config.ts`; every key is optional.

| Key | Default | Meaning |
|---|---|---|
| `comfyBase` | `http://127.0.0.1:8188` | ComfyUI base URL |
| `imagesDir` | `$XDG_DATA_HOME/dsh-genui/images` (`~/.local/share/dsh-genui/images`) | where renders are written and served from |
| `maxBatch` | `8` | upper bound on `count` for one request |
| `pollMs` | `750` | ComfyUI history poll interval while a job runs |
| `minPngBytes` | `30000` | a smaller PNG is a failed render, not a picture |
| `filePrefix` | `genui` | stem of render file names: `<filePrefix>_<lane>_<seed>.png` |
| `workflows` | `[real]` | image workflows this deployment exposes; `anime` is opt-in |
| `defaultOn` | `true` | a conversation answers as an OpenUI program unless `/openui off` says otherwise |

One ComfyUI job per batch: `batch_size = count`, one history entry, N images, so all frames of
a batch appear together and a failed frame fails the request.

## Workflows: what is on

A **workflow** is a lane plus everything it drags in: graphs, defaults, presets and prompt
text. Only `real` is on by default — one caption model, two graphs (fast and high), nothing
else to install, no extra prompt tokens.

`anime` is opt-in. Turning it on adds the anime lane, its fast/high graphs and its
full-checkpoint presets; turning it off means none of that is loaded, advertised to the model
or queued. A request that names a disabled lane is refused with a message saying what is
enabled, rather than waiting on checkpoints that were never there:

```yaml
# profile cordis.patch.yml, under the dsh-genui row
workflows: [real, anime]
```

What `anime` brings: `assets/anime.json`, `assets/anime-hq.json` and the preset graphs,
the `anime` lane in the tool surface, booru-tag prompt conventions, and
`assets/prompt-anime.md` — a section the host appends to the system prompt only when the
workflow is on. A default install never pays for it, in tokens or in prompt drift.

`lane` picks the workflow, `quality` picks how much compute to spend on it, and two more
knobs sit on top:

- `preset` swaps the anime checkpoint for a further full one at its own published settings.
  Presets belong to the anime workflow, and they replace `quality` rather than stacking with
  it: a distilled step budget turns an undistilled checkpoint into mush, so there is no
  cheaper honest setting.
- `upscale: 1.05–2` (or `true` for 1.5) adds a hires pass — `LatentUpscaleBy`, then a second
  sampler at denoise 0.45 with the same model and conditioning, then decode. About 60% more
  steps, trimmed to stay inside 4.2M pixels.

Both are part of the client's cache key, so a hires render never answers a fast request and
one preset never answers another.

## Routes

| Route | Method | Notes |
|---|---|---|
| `/genui/generate` | POST | `{ req: { prompt, lane?, quality?, preset?, upscale?, count?, steps?, cfg?, width?, height?, negative?, nsfw? } }` |
| `/genui/edit` | POST | `{ req: { prompt, source?, steps?, seed?, lora?, loraStrength? } }` |
| `/genui/images/<file>` | GET | `image/png`, immutable cache; the file name is validated before it touches disk |
| `/genui/health` | GET | `{ comfy: boolean, workflows: string[] }` |
| `/genui/mode` | GET | `{ default, sessions, off }`, or `{ session, openui }` with `?session=` |
| `/genui/mode` | POST | `{ session, enabled }` → `{ session, openui }` |

Security posture, because these routes are unauthenticated:

- the bind must stay on loopback — the routes are for the harness's own browser;
- every request must be same-origin (`Origin` / `Sec-Fetch-Site`), which is what stops another
  website from driving the GPU through a page the reader happens to have open;
- every POST must declare `application/json`, bodies are capped at 1 MB;
- image names are matched against `^[A-Za-z0-9][A-Za-z0-9._-]*\.png$`, so no path separator and
  no traversal ever reaches the filesystem.

## The mode: `/openui`

Whether the assistant answers as an interface is a **per-conversation** mode, not a profile
decision:

```text
/openui on      → this conversation answers as an OpenUI program
/openui off     → this conversation answers in ordinary markdown
/openui         → report this conversation's mode
```

Conversations start **on** (`defaultOn`). `/openui off` opts one conversation out; the choice
lives in `$DSH_HOME/genui-mode.json` (or `~/.dsh/genui-mode.json`) and survives a restart. Only
the difference from the default is stored:

```json
{ "default": true, "sessions": [], "off": ["session-…"] }
```

That is deliberate. Setting a conversation back to the default drops its entry instead of
writing a redundant one, so a later `defaultOn: false` moves every conversation nobody has
expressed an opinion about.

The client paints either shape: a program goes to the OpenUI renderer, prose goes to the
harness's own markdown renderer. Turning the mode off cannot leave a transcript blank or
unformatted.

```bash
curl -s 'http://127.0.0.1:3080/genui/mode'
curl -s 'http://127.0.0.1:3080/genui/mode?session=<session-id>'
curl -s -X POST -H 'content-type: application/json' -H 'origin: http://127.0.0.1:3080' \
  --data '{"session":"<session-id>","enabled":true}' http://127.0.0.1:3080/genui/mode
```

## The prompt is additive

The OpenUI section is an ordinary ordered section (`genui:openui`), never `complete`. It is
attached from the `system-prompt/assemble` waterfall, and that listener is **prepended**, so
its post-`next()` code runs last. A profile may also run a bundle that owns the whole prompt
and replaces `assembly.sections` with its own persona; a prepended listener appends after that
rewrite, a plain one is computed and then thrown away. `test/assembly.test.ts` runs the real
`SystemPrompt` service against both shapes.

Consequences worth knowing:

- the answer format is a rule the model follows, not the whole prompt, so a turn that goes
  wrong degrades into a normal harness answer instead of into nothing;
- it composes with any agent preset, including ones that own a complete persona section.

## The assistant row and replay

The answer's row replaces the built-in `assistant-step` renderer at priority `-1` in the
keyed `conversation.chat.node` slot. It does not claim the assistant events with an exclusive
Definition, which would stop the built-in definition from publishing the payload that
Turn-tail, the token footer and the process disclosure read. Only the pixels change; the
evidence is in [docs/client-contract.md](docs/client-contract.md).

Storage follows from cost. A render is expensive and a stored answer replays its
`Query("generate_image", …)` every time the chat is reopened, so:

- renders are cached by the request that produced them — in memory for the session, mirrored
  to IndexedDB so they survive a restart;
- a step painted `running` in this page session was produced live and may queue ComfyUI;
- a step that is already settled the first time it is painted came out of the session log and
  may only display what the cache already holds. A miss paints "this picture is not saved on
  this machine" with an explicit retry, which re-enables generation for that answer alone.

Reopening a conversation therefore never re-runs old prompts.

## Models and graphs

Lane and preset ids are stable; which checkpoint a lane loads is a property of the graph, so a
deployment with different weights keeps the ids and swaps the templates. The registry lives in
`src/host/models.ts`, the ids in `src/shared/models.ts` (shared with the client tool schema, so
the two cannot drift), and the contract for editing or replacing a graph — including where the
opt-in workflow's prompt text lives — is in [docs/graphs.md](docs/graphs.md).

## Development

```bash
bun install
bun test                 # unit tests, no ComfyUI required
bun run typecheck
bun run build            # writes lib/index.js and lib/client.js
bun run prompt           # regenerate the OpenUI half of the system prompt
```

`lib/client.js` is a `window.__ModuleLoader__.load({ id: "dsh-genui", factory })` bundle.
React, React DOM, cordis and the harness's markdown primitives stay external because the shell
seeds those instances. The committed bundle is checked into `lib/` on purpose, and CI fails if
it drifts from `src/`.

The system prompt is assembled at request time from three assets: the catalogue OpenUI
generates from `src/client/library.tsx` (`assets/prompt-core.txt`), the optional
`assets/prompt-anime.md`, and the hand-written rules in `assets/prompt-rules.md`, which are
always last. `bun run prompt` regenerates the catalogue as a *candidate*; the committed
catalogue is hand-edited for the harness's voice, so adopt the diff rather than overwriting the
file. Tests fail if the committed prompt stops ending with the rules asset, or if a default
install starts shipping the anime section.

Layout:

```
src/host/     Cordis plugin: config, prompt section, mode store, /openui command,
              ComfyUI client, graph mutation, model registry, render store, routes
src/client/   browser plugin: assistant-row renderer, OpenUI renderer, component library,
              cache-first query provider, image styles
src/shared/   the lane/quality/preset roster both halves import
assets/       committed ComfyUI graphs, the OpenUI prompt, its hand-written rules
lib/          built bundles, committed
test/         unit tests, fixtures, fake ComfyUI
docs/         the graph contract, the client-contract findings
```

## Limitations

- A source-less `edit_image` is cached under the request alone, so asking for the same edit of
  "the newest render" in a later session can replay the earlier result. Replay needs the cache
  key to be derivable from the program, and the program does not name the source.
- The client bundle is ~3.8 MB minified: OpenUI pulls d3, katex, a syntax highlighter,
  react-markdown, radix and lucide. First paint has not been measured.
- A source-less edit of an image ComfyUI names with a subfolder is uploaded under the bare file
  name; ComfyUI 0.43 answers with no subfolder, which is the only shape observed.
- `src/client/repair.ts` covers the argument-shape drifts seen in stored answers (`Card`
  direction vs variant, `Text` value vs variant, `Callout` description/binding). New
  library-wide renames would need a new rule rather than being repaired automatically.

## Not in scope

Chat streaming, session storage, settings UI, web access, ComfyUI itself, ComfyUI autostart,
and progressive per-frame batch rendering. Each frame of a batch lands with the batch.

## License

MIT. See [LICENSE](LICENSE).
