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
| `filePrefix` | `genui` | stem of render file names; ComfyUI writes them under `ds-<YYYY-MM-DD>/` |

Renders land in ComfyUI's output folder under a date folder, `ds-2026-11-05/`, so a day of
pictures is one directory instead of a flat pile: `SaveImage.filename_prefix` is
`ds-<date>/<filePrefix>_<lane>_<seed>` and ComfyUI creates the subfolder. The plugin's own
copy in `imagesDir` stays flat and is served from `/genui/images/...`.
| `workflowDir` | `$DSH_HOME/genui/workflows` | where user workflow definitions are read from |
| `workflows` | `[real]` | enabled workflow ids; volatile, so Settings changes it live |
| `defaultOn` | `true` | a conversation answers as an OpenUI program unless `/openui off` says otherwise; volatile, so Settings can flip it live |

One ComfyUI job per image. A `count` above 1 is a *queue* owned by `src/client/batches.ts`: the
frames are rendered one at a time and published as each lands, so a four-image request shows
the first picture after roughly one render instead of after all four. Each frame has its own
cache slot, so a reload or a rerun re-renders only what is missing, and a frame that fails
keeps its error without taking the rest of the set down. The trade is throughput: separate jobs
cannot share one model load, so a batch is slightly slower end to end than `batch_size = N`, and
the first picture arrives far sooner.

A single-image request is still one job, unchanged.

The grid follows the number of frames — one, two, three wide, two for four, three for five or
six, four for seven or eight — rather than the two columns it used to assume, and the cells
take the first frame's own aspect ratio instead of being square, so a portrait render is not
cropped at the head and feet. A frame that failed and a frame that was never rendered here are
different cells: the first retries by itself, the second says so and offers to render the set.

## Workflows

A **workflow** is a lane plus everything it drags in: one or two graphs (fast/high), the
settings they are tuned for, optional preset graphs, and an optional prompt section. The
bundle ships three — `real`, `anime` and `moss` — and only `real` is enabled by default: one
caption model, two graphs, nothing else to install, no extra prompt tokens. The other two are
opt-in, in Settings or in the profile, because they cost either a second checkpoint or a much
longer wait.

**Adding one is data, not code.** Drop a definition and its graph into the workflow directory
(`$DSH_HOME/genui/workflows`, otherwise `~/.local/share/dsh-genui/workflows`), and it appears
in the list — no rebuild, no restart, any number of them. The format and a worked example are
in [docs/add-workflow.md](docs/add-workflow.md); a definition that ships inside the bundle is
described in [AGENTS.md](AGENTS.md).

**In the browser:** Settings → General → *Image workflows* lists every workflow the harness
found. Each row has a switch and, when the definition came from a file, a delete button.
Built-ins can be disabled but not deleted — deleting the file would just unmask the packaged
graph on the next start. The enabled set is written through the harness settings document (the
profile's Cordis patch), and because the field is volatile the change lands on the next answer:
the prompt section appears or disappears and `/genui/health` reports the new set. A workflow
that is enabled but whose files have gone missing is shown as an orphan, so you can remove it
without hunting for the config.

**In a profile:** the same thing as a file, when you want it pinned rather than toggled:

```yaml
# profile cordis.patch.yml, under the dsh-genui row
workflows: [real, anime, moss]
```

The list only exists where the client composes the settings service (the stock web profile
does). Without it the bundle still renders answers and there is simply no list.

What `anime` brings: `assets/anime.json`, `assets/anime-hq.json` and the preset graphs, the
`anime` lane in the tool surface, booru-tag prompt conventions, and `assets/prompt-anime.md` —
a section the host appends to the system prompt only when the workflow is on. A default
install never pays for it, in tokens or in prompt drift.

What `moss` brings: `assets/moss-fast.json` and `assets/moss-high.json` — the same 5B weights
`real` runs, on the undistilled SFT checkpoint instead of the four-step LoRA, at the model
card's own settings (25 steps at CFG 2.5 with `er_sde`; 50 at CFG 3 with euler and
skip-layer guidance on layer 22). It sets `allowsText`, so the no-text negative block is not
applied and quoted lettering survives, and `assets/prompt-moss.md` teaches the model to
prompt it as a caption rather than a tag line. Reach for it for a long prompt, a laid-out
scene, or a picture that has to spell something; reach for `real` for anything quick.

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
| `/genui/workflows` | GET | every known workflow with its enabled flag, and the directory they are read from |
| `/genui/workflows` | POST | `{ action: "remove", id }` — deletes a user definition; built-ins are refused |
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

**The default itself is a switch.** Settings → General → *Answer as interface by default*
writes the volatile `defaultOn` field, and the mode store reads it per answer: turning it off
makes interface answers opt-in, so a new conversation is plain markdown until `/openui on`,
and turning it back on flips every conversation that never chose. Existing per-conversation
overrides keep their meaning across the change.

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

A workflow is a definition, not a class: `src/host/workflows.ts` holds the shipped ones and
loads the rest from the workflow directory, `graphs.ts` knows only how to mutate a graph, and
the prompt is assembled from the sections of the workflows that are enabled. The graph contract
is in [docs/graphs.md](docs/graphs.md); adding a workflow is
[docs/add-workflow.md](docs/add-workflow.md).

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
              ComfyUI client, workflow registry, graph mutation, render store, routes
src/client/   browser plugin: assistant-row renderer, OpenUI renderer, component library,
              cache-first query provider, the Settings → General workflow row, image styles
src/shared/   the lane/quality/preset roster both halves import
assets/       committed ComfyUI graphs, the OpenUI prompt, its hand-written rules
lib/          built bundles, committed
test/         unit tests, fixtures, fake ComfyUI
docs/         the graph contract, adding a workflow, the client-contract findings
AGENTS.md     the working contract for agents: invariants, recipes, definition of done
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

Chat streaming, session storage, settings UI, web access, ComfyUI itself and ComfyUI
autostart.

## License

MIT. See [LICENSE](LICENSE).
