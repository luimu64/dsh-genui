# dsh-genui

A DeepSeek Harness bundle that renders OpenUI Lang assistant replies and executes
`generate_image` / `edit_image` queries against the local ComfyUI. It is the
`genui-harness` product behavior without the Tauri shell: DSH owns chat streaming,
sessions, settings, and web access; this bundle owns the OpenUI prompt, the ComfyUI graph
mutation and client, the PNG store, and the renderer.

## Architecture

```
User prompt
  -> DSH agent loop
     -> optional web_search / web_fetch tool calls
     -> final assistant message containing OpenUI Lang
        -> DSH session log stores the text
        -> DSH client renders the assistant step
           -> dsh-genui shadows the assistant-step renderer (priority -1)
           -> OpenUI Renderer parses the program
              -> Query("generate_image")
                 -> per-turn toolProvider
                    -> cache hit? render it
                    -> cache miss + live turn? POST /genui/generate
                       -> host builds a graph from a committed template
                       -> ComfyUI /api/prompt, /history, /view
                       -> PNG saved under imagesDir
                       -> { url: "/genui/images/<file>", ... }
                    -> cache miss + history? return a missing marker
              -> GenImage / GenImageSet renders the URL or a missing frame
```

- `src/host/` — Cordis plugin: config, prompt registration (additive, main agent only), ComfyUI
  graph mutation, ComfyUI client, render store, generation service, `/genui/*` routes.
- `src/client/` — browser plugin: the assistant-row renderer, the OpenUI renderer, the genui
  component library, the cache-first query provider, and the image styles.
- `assets/` — the five committed ComfyUI graphs and the OpenUI system prompt.
- `lib/` — generated and committed, so the bundle installs without a build step.

## Toolchain baseline

Verified on `mainframe` (2026-11-04):

```bash
export PATH="$HOME/.bun/bin:$HOME/.local/share/dsh/node24/bin:$PATH"
node --version          # v24.22.2 (official Node 24; nixpkgs Node fails the native addon)
bun --version           # 1.4.4
pnpm --version          # 11.28.5
dsh --version           # 0.2.1-rc.5
curl -fsS http://127.0.0.1:8188/system_stats   # ComfyUI 0.43.2
```

Nothing in this repository needs a global install. Bun is not on `PATH` by default on
this box, which is the one thing the export above is for.

## Build and test

```bash
cd /home/luimu/projects/dsh-genui
bun install
bun test
bun run typecheck
bun run build            # writes lib/index.js and lib/client.js
```

`lib/client.js` is a `window.__ModuleLoader__.load({ id: "dsh-genui", factory })` bundle:
React, React DOM, zod, and cordis stay external because the shell seeds those instances.

## Install into a profile

The bundle composes as one row named `dsh-genui`, configured from `cordis.patch.yml`.

```bash
export PATH="$HOME/.bun/bin:$HOME/.local/share/dsh/node24/bin:$PATH"
export DSH_HOME="$HOME/.dsh-genui"

# 1. create the profile from the shipped web template
dsh --profile genui --from-default-profile web --dump-config >/dev/null

# 2. link this checkout into it
cd /home/luimu/projects/dsh-genui
dsh plugin --profile genui add .

# 3. confirm the row and its config
dsh --profile genui --dump-config | sed -n '/dsh-genui/,+6p'
```

`$DSH_HOME/profiles/genui/cordis.patch.yml` is the user layer. It carries the Bifrost
provider route (`llm-pi-ai` → `bifrost`), so one profile reproduces the app's model and the
plugin. That file holds secrets: keep it `0600` and do not commit it.

```bash
# 4. boot on a second port next to the stock 3080 instance
export OPENCODE_GO_API_KEY="<bifrost key>"
dsh --profile genui --no-open --port 3081

# 5. from another shell
curl -fsS http://127.0.0.1:3081/genui/health     # {"comfy":true}
```

The host routes 404 until the bundle row activates. If they do, check the DSH log for a
`dsh-genui` load error before touching the client.

## Routes

| Route | Method | Notes |
|---|---|---|
| `/genui/generate` | POST | `{ req: { prompt, lane?, quality?, count?, steps?, cfg?, width?, height?, negative?, nsfw? } }` |
| `/genui/edit` | POST | `{ req: { prompt, source?, steps?, seed?, lora?, loraStrength? } }` |
| `/genui/images/<file>` | GET | `image/png`, immutable cache; the file name is validated |
| `/genui/health` | GET | `{ comfy: boolean }` |
| `/genui/mode` | GET | `{ sessions }`, or `{ session, openui }` with `?session=` |
| `/genui/mode` | POST | `{ session, enabled }` → `{ session, openui }` |

All routes require a loopback origin (`Origin`/`Sec-Fetch-Site`); POSTs must declare
`application/json`. The bind stays on loopback: these routes are unauthenticated, so the
origin check only stops a browser on another site from using them.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `comfyBase` | `http://127.0.0.1:8188` | ComfyUI base URL |
| `imagesDir` | `~/.local/share/openui-harness/images` | where renders are written and served |
| `maxBatch` | `8` | upper bound on `count` |
| `pollMs` | `750` | history poll interval |
| `minPngBytes` | `30000` | a smaller PNG is a failed render, not a picture |

One ComfyUI job per batch: `batch_size = count`, one history entry, N images. All frames of
a batch appear together; a failed frame fails the request.

## The mode

Whether the assistant answers as an interface program is a **per-conversation** mode, not a
profile decision and not an instance-wide flag. `/openui` in the composer acts on the
conversation you typed it in:

```text
/openui on      → this conversation answers as an OpenUI program
/openui off     → this conversation answers in ordinary markdown
/openui         → report this conversation's mode
```

Conversations start **off**. The set of enabled session ids lives in
`$DSH_HOME/genui-mode.json` (or `~/.dsh/genui-mode.json`), so a restart keeps each
conversation's choice. Toggling one conversation cannot change another's answers.

Two details make the toggle work in practice:

- the section is attached to **every main agent**, including the ones already open when the
  plugin loads (`ctx.agents.list()` at apply), because an agent that was created before the
  plugin existed would otherwise never receive it — that is why a conversation could answer in
  markdown with the mode nominally on;
- the section text and the render list are providers read at every assembly, so the toggle
  lands on the next turn without recreating the agent. Off renders both to nothing.

The client keeps painting either shape: a program goes to the OpenUI renderer, prose goes to
the harness's own markdown renderer. Turning the mode off cannot leave the transcript blank or
unformatted.

```bash
curl -s 'http://127.0.0.1:3080/genui/mode'                       # every session that is on
curl -s 'http://127.0.0.1:3080/genui/mode?session=<session-id>'
curl -s -X POST -H 'content-type: application/json' -H 'origin: http://127.0.0.1:3080' \
  --data '{"session":"<session-id>","enabled":true}' http://127.0.0.1:3080/genui/mode
```

## The prompt is additive

The OpenUI section is registered as an ordinary ordered section (`genui:openui`, order 950),
never as `complete: true`. It is added from the `system-prompt/assemble` waterfall, and that
listener is **prepended**, so its post-`next()` code runs last. That is what keeps it alive in a
profile that also runs a bundle owning the whole prompt: `dsh-liberation` prepends a listener
that replaces `assembly.sections` with its own persona, and a plain listener's section is
computed and then thrown away — the mode reads on, the route answers, and the model still gets
markdown. Prepending appends the section *after* that rewrite. `test/assembly.test.ts` runs the
real `SystemPrompt` service against both shapes. The harness keeps its identity, tool guidance, sandbox and
approval policy; this only adds the answer format on top, which is why it can sit in a profile
you also use for coding. Two consequences:

- the answer format is a rule the model follows, not the whole prompt, so a turn that goes
  wrong degrades into a normal harness answer rather than into nothing;
- it composes with every agent preset, including the shipped `minimal` preset that owns a
  complete persona section (a complete section of our own would have made assembly throw).

The separate `genui` profile is therefore a convenience, not a necessity: it keeps the OpenUI
answer style (and the 3.8 MB client bundle that paints it) off the instance used for other work.

## The assistant row

The answer's row is painted by replacing the `assistant-step` renderer at priority `-1` in the
keyed `conversation.chat.node` slot, not by claiming the assistant events with an exclusive
Definition. The installed client builds Turn-tail's copy/fork/usage banner from the business
Assistant payload (`FinalAssistantChatData.finalNode`), and an exclusive claim on
`assistant/message` is exactly what stops that payload from being published; a Definition
also may not publish Location data under another Definition's key. Shadowing the renderer
keeps every built-in projection whole and changes only the pixels. `test/spike.md` records
the evidence and what an operator should still check in a browser.

## Replay

A step that was painted `running` in this page session was produced live and may queue
ComfyUI. A step that is already settled the first time it is painted came out of the session
log and may only display what the render cache already holds. A cache
miss on a stored turn paints "this picture is not saved on this machine" with an explicit
retry, which re-enables generation for that row only. Reopening a conversation therefore
never re-runs old prompts.

## Known limitations

- A source-less `edit_image` is cached under the request alone, so asking for the same edit
  of "the newest render" in a later session can replay the earlier result. Replay needs the
  key to be derivable from the program, and the program does not name the source.
- The client bundle is ~3.8 MB minified: OpenUI pulls d3, katex, a syntax highlighter,
  react-markdown, radix, and lucide. First paint has not been measured; the browser check in
  `test/spike.md` owns that.
- A source-less edit of an image that ComfyUI names with a subfolder is uploaded under the
  bare file name; ComfyUI 0.43 answers with no subfolder, which is the only shape observed.

## Not in scope

The Tauri shell, chat streaming, session storage, settings UI, web tools, agent-callable
image tools (the OpenUI `Query()` path is the contract), ComfyUI autostart, and progressive
per-frame batch rendering.
