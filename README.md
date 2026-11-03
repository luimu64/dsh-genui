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
           -> dsh-genui Definition claims the step (exclusive)
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

- `src/host/` — Cordis plugin: config, prompt registration (main agent only), ComfyUI
  graph mutation, ComfyUI client, render store, generation service, `/genui/*` routes.
- `src/client/` — browser plugin: the `assistant-step` Definition, the OpenUI renderer, the
  genui component library, the cache-first query provider, and the image styles.
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

## Replay

Every rendered assistant step records whether it started from a live chunk. A live turn may
queue ComfyUI; a stored turn may only display what the render cache already holds. A cache
miss on a stored turn paints "this picture is not saved on this machine" with an explicit
retry, which re-enables generation for that row only. Reopening a conversation therefore
never re-runs old prompts.

## Not in scope

The Tauri shell, chat streaming, session storage, settings UI, web tools, agent-callable
image tools (the OpenUI `Query()` path is the contract), ComfyUI autostart, and progressive
per-frame batch rendering.
