# dsh-genui

A DeepSeek Harness bundle that lets the assistant answer in **OpenUI Lang** — a declarative
UI language — and paints that answer as interface instead of markdown.

The harness keeps everything it normally owns: chat streaming, sessions, settings, tools,
sandbox and approval policy. This bundle adds an answer *format*, the renderer that draws it,
and a component library wide enough to answer with tables, charts, forms, cards and images.

```text
user prompt
  -> DSH agent loop                        (identity, tools, approvals: unchanged)
     -> final assistant message in openui-lang
        -> session log stores the text
        -> dsh-genui shadows the assistant-step renderer (priority -1)
           -> OpenUI renderer parses the program
              -> Query("some_tool", ...)  ->  a tool a companion bundle registered
              -> the drawn components   ->  painted by the library
```

**Image generation is not part of this bundle.** `generate_image` and `edit_image` live in
[dsh-genui-images](https://github.com/luimu64/dsh-genui-images), an optional ComfyUI bundle
that registers itself into this one. Install it for pictures; leave it out and this bundle
answers with everything else. The image *components* (`GenImage`, `GenImageSet`, `ImageBlock`,
`Image`, `ImageGallery`) ship here either way, because they paint a URL, not a render.

## Requirements

- DeepSeek Harness `>=0.2.1-rc.5 <0.3.0`, with the web client.
- Node 24 (the official build; nothing native to compile).
- Bun, for development only.

## Install

```bash
# 1. a profile to install into (skip if you already have one)
dsh --profile genui --from-default-profile web --dump-config >/dev/null

# 2. link this checkout into it
dsh plugin --profile genui add .

# 3. confirm the row arrived
dsh --profile genui --dump-config | sed -n '/dsh-genui/,+6p'
```

```bash
# 4. boot it
dsh --profile genui --no-open --port 3081
```

`lib/` is committed, so installing from a checkout needs no build step. For pictures, install
`dsh-genui-images` the same way; it depends on this row being present and does nothing on its
own.

## Configuration

Resolved by `src/host/config.ts`; every key is optional.

| Key | Default | Meaning |
|---|---|---|
| `defaultOn` | `true` | a conversation answers as an OpenUI program unless `/openui off` says otherwise; volatile, so Settings → General can flip it live |

That is the whole config. Image generation, workflow lanes and the renders directory are the
image bundle's config entry (`genui-images`).

## The mode: `/openui`

Per conversation, not per instance. A harness used for everything cannot have one global
switch: turning interface answers on for one conversation should not rewrite the format of
every other one. `/openui on`, `/openui off` and `/openui status` are registered in the
composer and stored per session (see `src/host/mode.ts`); the instance default is `defaultOn`,
and only deviations from it are persisted, so flipping the default moves every conversation
that never said anything.

`GET /genui/mode` reports the default and the overrides; `POST /genui/mode` with
`{session, enabled}` is what the command writes.

## The prompt is additive

`src/host/prompt.ts` prepends a `system-prompt/assemble` listener and appends one section,
`genui:openui`. It is not `complete`: the harness keeps its identity, tools, sandbox and
approval policy, and this only adds the answer format on top. The listener is prepended so it
survives a profile where another bundle owns the whole prompt and replaces `sections`.

The section is assembled from `assets/prompt-core.txt` and `assets/prompt-rules.md` plus
whatever companion bundles register — see [docs/extension-points.md](docs/extension-points.md).
A deployment with no image bundle is told so, in as many words, instead of being offered a
tool that does not exist.

Subagents keep the harness's normal prompt and answer in plain text.

## The assistant row and replay

The row shadows the built-in `assistant-step` renderer at priority `-1` rather than claiming
the assistant events, so Turn-tail, the token footer and the process disclosure keep working.
A stored answer replays its `Query()` calls when it is painted, which is exactly why a query
has to know whether it is being *made* or only *displayed*: the provider it resolves is bound
to that answer's turn (`src/client/tools.ts`), and a replay gets no permission to spend
anything.

See [docs/client-contract.md](docs/client-contract.md) for the reasoning and the browser
checks.

## The component library

`src/client/library.tsx` is OpenUI's own library extended with `GenImage` and `GenImageSet`,
and with `ImageBlock` / `Image` / `ImageGallery` overridden so every picture in an answer gets
the same frame, full-size viewer and download action. A set of pictures renders as one grid;
when a companion registers progressive frames (the image bundle does) each cell fills in as
its frame lands, and without one the list is painted from the URLs it carries.

Those five go through the same registry a companion uses (`src/client/components.ts`,
`ctx.genuiClient.registerComponents`), so the library is not a closed set: any bundle can add a
component *and* the catalogue line that tells the model when to reach for it. The library is
re-derived on every change, which is what lets a component registered a moment after an answer
mounted still paint. See [docs/extension-points.md](docs/extension-points.md#components).

## Development

```bash
bun test         # 126 tests, no network, no browser
bun run typecheck
bun run build    # writes lib/index.js and lib/client.js; both are committed
```

`test/bundle.test.ts` materialises the built client bundle in a fake browser and asserts what
it registers, so a build that breaks the row fails the suite rather than the page.

## Not in scope

- Persisting programs as anything other than text in the session log.
- A second renderer for the built-in markdown row: the mode is per conversation, and a
  conversation that opts out is painted by the harness exactly as before.

## License

MIT.
