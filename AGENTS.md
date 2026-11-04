# AGENTS.md — working in dsh-genui

Operational contract for any agent (or human) changing this repository. Read it before you
edit; it records the invariants that the tests do not catch for you.

## What this is

A DeepSeek Harness bundle in two halves:

- `src/host/` — Cordis plugin. Config, workflow registry, ComfyUI client, graph mutation,
  render store, `/genui/*` routes, `/openui` mode and command.
- `src/client/` — browser plugin. The assistant-row renderer, the OpenUI component library,
  the cache-first query provider, and the Settings → General workflow list.
- `src/shared/models.ts` — the vocabulary both halves share. Keep it tiny.
- `assets/` — committed ComfyUI graphs, the prompt catalogue, the hand-written prompt rules.
- `lib/` — **generated**. `bun run build` writes `lib/index.js` and `lib/client.js`; both are
  committed because the bundle installs without a build step. Never edit them by hand, and
  always rebuild before committing (`test/bundle.test.ts` reads `lib/client.js`).

## Hard rules

1. **No machine-specific values.** No `/home/...`, no hostnames, no model names outside the
   workflow definitions and their docs. Defaults derive from `$XDG_DATA_HOME` / `$DSH_HOME`.
2. **Workflows are data.** A new image pipeline is a definition plus graphs, not new control
   flow. `src/host/workflows.ts` is the only file that may know what a workflow is; `graphs.ts`
   only mutates a graph it is handed.
3. **Anything the Settings page writes must be `volatile()`** in the Schemastery config, and
   read through `.get()` at the point of use. A captured value freezes the GUI.
4. **The prompt is assembled, not stored whole.** `prompt-core.txt` + each enabled workflow's
   section + `prompt-rules.md`. Never hardcode a workflow's prompt into the core.
5. **Tests are the contract.** `bun test`, `bun run typecheck`, `bun run build`. All three must
   be clean, and the build output must be part of the commit.
6. **Small, honest commits.** Conventional prefix (`feat:`, `fix:`, `docs:`, `test:`), the body
   says what changed and why, no attribution noise.

## Adding or changing a workflow

There are two paths. Choose by who the workflow is for.

### A. A deployment-local workflow (no source change)

1. Create a directory entry, e.g. `$DSH_HOME/genui/workflows/sketch.json` (or
   `<data>/dsh-genui/workflows/sketch.json` when `DSH_HOME` is unset), with the definition
   described in [docs/add-workflow.md](docs/add-workflow.md).
2. Put its graph file(s) next to it. ComfyUI *Save (API Format)* output, verbatim, keeping the
   node ids documented below.
3. Enable it: Settings → General → the workflow list, or `workflows: [real, sketch]` in the
   profile's `cordis.patch.yml`.
4. Verify with a prompt that asks for that lane, and check `/genui/health`.

Nothing is rebuilt or restarted: the registry rescans on an unknown id and on every list read,
and the service and prompt both read the registry per request.

### B. A workflow shipped in the bundle

1. Add the graph(s) to `assets/` (or keep them next to a definition in `assets/`).
2. Add a definition to `BUILTINS` in `src/host/workflows.ts` (id, label, description, `fast` and
   optional `high`, optional `presets`, optional prompt asset name). Built-ins import their
   graphs statically so the bundle needs no file reads at boot.
3. If the workflow needs prompt text, add `assets/prompt-<id>.md` and name it in the
   definition. It is appended after the core catalogue and before the rules, only while the
   workflow is enabled.
4. Extend `test/graphs.test.ts` if the workflow has unusual settings, and `test/workflows.test.ts`
   if it changes registry behaviour.
5. `bun test && bun run typecheck && bun run build`, then commit source *and* `lib/`.

## Graph invariants

The mutator addresses nodes by id, so a template must keep this skeleton (full table in
[docs/graphs.md](docs/graphs.md)):

| Node | Role | Written by code |
|---|---|---|
| `3` | positive prompt | prompt, appended to the template prefix when `carriesStyle` |
| `4` | negative prompt | `negative`, and the `nsfw` strip |
| `5` | empty latent | width, height, batch size |
| `6` | base KSampler | seed, steps, cfg |
| `7` | VAEDecode | rewired only for a hires pass |
| `9` | SaveImage | `filename_prefix` |
| `21`, `22` | hires pass | added at runtime, never present in a template |

The edit lane is the exception: it has its own numbering and is documented in
`src/host/workflows.ts`.

## Where things go

- New HTTP surface → `src/host/routes.ts`, with the same origin/JSON guards as its neighbours.
- New client surface → a component under `src/client/`, registered from `src/client/index.tsx`
  behind `ctx.inject([...])` so a shell without that service still loads the renderer.
- New user-visible copy → keep it in the component; this bundle registers no locale namespace.
- New config key → `src/host/config.ts`, with a comment, a sane non-personal default, and a
  test in `test/config.test.ts`.

## Definition of done

- [ ] `bun test` green, `bun run typecheck` clean, `bun run build` run and `lib/` committed.
- [ ] No new absolute path, hostname, or personal identifier anywhere in `src/`, `assets/`,
      `cordis.patch.yml` or the docs.
- [ ] The README/config/docs say how a reader turns the new thing on.
- [ ] Behaviour that a stored conversation depends on (cache keys, file names, prompt sections)
      either unchanged or called out in the commit message.
