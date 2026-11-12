# AGENTS.md — working in dsh-genui

Operational contract for any agent (or human) changing this repository. Read it before you
edit; it records the invariants the tests do not catch for you.

## What this is

The renderer half of the OpenUI answer format, and nothing else:

- `src/host/` — Cordis plugin. The `/openui` mode and command, the assembled system prompt,
  the `/genui/mode` route, and the `genui` service a companion bundle registers into.
- `src/client/` — browser plugin. The assistant-row renderer, the OpenUI component library
  (image components included — they paint URLs), the query-tool and frame-source registries,
  and the Settings → General answer-format switch.
- `assets/` — the committed prompt: the language and catalogue, and the harness rules.
- `lib/` — **generated**. `bun run build` writes `lib/index.js` and `lib/client.js`; both are
  committed because the bundle installs without a build step. Never edit them by hand, and
  always rebuild before committing (`test/bundle.test.ts` reads `lib/client.js`).

Image generation is a **separate repository**, `dsh-genui-images`. It is not a dependency of
this package in either direction: it waits for the `genui` (host) and `genuiClient` (browser)
services and contributes prompt text, query tools and progressive frames. See
[docs/extension-points.md](docs/extension-points.md).

## Hard rules

1. **No machine-specific values.** No `/home/...`, no hostnames. Defaults derive from
   `$XDG_DATA_HOME` / `$DSH_HOME` where there are any — this bundle now has none.
2. **No generation in this repository.** A ComfyUI client, a workflow graph, an images
   directory, a batch queue or a GPU has no business here. If a change needs one, it belongs
   in the companion, reached through the two services.
3. **Anything the Settings page writes must be `volatile()`** in the Schemastery config, and
   read through `.get()` at the point of use. A captured value freezes the GUI.
4. **The prompt is assembled, not stored whole.** `prompt-core.txt` + registered blocks +
   `prompt-rules.md`. Anchor markers (`<!-- genui:tools -->`, `<!-- genui:components -->` and
   friends) are the only places a companion's text may land; never hardcode a companion's
   paragraph into the core.
5. **A component is two halves.** The renderer is registered in the browser, the catalogue line
   on the host; a component with only one of them is either uncallable or unpaintable. The
   library is *derived* from the registry (`src/client/components.ts`) because the renderer
   memoizes a parser by library identity — never mutate it in place.
6. **A tool is a function of the turn.** `Query()` handlers receive `GenuiTurnAccess` and must
   refuse to do work when `mayGenerate()` is false. This is the replay gate; a handler that
   ignores it re-renders last week's pictures every time a conversation is opened.
7. **Tests are the contract.** `bun test`, `bun run typecheck`, `bun run build`. All three must
   be clean, and the build output must be part of the commit.
8. **Small, honest commits.** Conventional prefix (`feat:`, `fix:`, `docs:`, `test:`), the body
   says what changed and why, no attribution noise.

## The two services

| Service | Where | Consumed by |
|---|---|---|
| `genui` (host) | `src/host/registry.ts` | a companion's `apply`: prompt blocks, components, contexts |
| `genuiClient` (browser) | `src/client/service.ts` | a companion's `apply`: query tools, components, frame sources |

Both are published with `ctx.provide` and both return disposers. Renaming either one breaks a
companion silently — the companion simply never registers, and the model is never told about
its tools. If a rename is unavoidable, bump the major version and update
docs/extension-points.md in the same commit.

A module augmentation of `@deepseek-ai/cordis` must live in a file that also imports from it.
An augmentation declared in a file with no such import breaks the package's own `Context`
interface merge for the whole program (every `ctx.effect`/`ctx.inject` in the tree stops
type-checking), which is a confusing afternoon.

## Where things go

- New HTTP surface → `src/host/routes.ts`, with the same origin/JSON guards as its neighbours.
- New client surface → a component under `src/client/`, registered from `src/client/index.tsx`
  behind `ctx.inject([...])` so a shell without that service still loads the renderer.
- New user-visible copy → keep it in the component; this bundle registers no locale namespace.
- New config key → `src/host/config.ts`, with a comment and a sane non-personal default. The
  test in `test/config.test.ts` asserts the key list, because a generator key appearing here
  is the split leaking.

## Definition of done

- [ ] `bun test` green, `bun run typecheck` clean, `bun run build` run and `lib/` committed.
- [ ] No new absolute path, hostname, or personal identifier anywhere in `src/`, `assets/`,
      `cordis.patch.yml` or the docs.
- [ ] The README says how a reader turns the new thing on, and whether it needs the companion.
- [ ] Behaviour that a stored conversation depends on (cache keys, component names, prompt
      anchors) either unchanged or called out in the commit message.
