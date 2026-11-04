# Adding a workflow

A **workflow** is one selectable image pipeline: the lane id a prompt may ask for, one or two
ComfyUI graphs (fast/high), the settings those graphs are tuned for, optional preset graphs,
and optional prompt text explaining the lane to the model. Adding one is a data change.

Two ways to do it: drop files into the workflow directory (no build, no restart), or ship one
inside the bundle. The first is the usual case.

## Where definitions live

- Each `*.json` in the workflow directory defines one workflow. Its graph files and its prompt
  file are read from the same folder.
- The directory is `workflowDir`: `$DSH_HOME/genui/workflows` when `DSH_HOME` is set, otherwise
  `$XDG_DATA_HOME/dsh-genui/workflows` (`~/.local/share/dsh-genui/workflows`).
- The shipped workflows (`real`, `anime`) are built in. A definition may not reuse a built-in
  id — it is ignored with a log line rather than silently shadowing.

## The definition

```json
{
  "id": "sketch",
  "label": "Sketch & ink",
  "description": "Line-art models: short prompts, four steps, no style prefix.",
  "suffix": "sketch",
  "carriesStyle": false,
  "graphs": {
    "fast": "sketch-fast.json",
    "high": "sketch-high.json"
  },
  "defaults": {
    "width": 832,
    "height": 1216,
    "steps": { "fast": 4, "high": 24 },
    "cfg": { "fast": 1, "high": 2.5 }
  },
  "presets": {
    "rough": { "graph": "sketch-rough.json", "steps": 18, "cfg": 3 }
  },
  "prompt": "sketch.prompt.md"
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | the `lane` value a request uses. `^[a-z0-9][a-z0-9_-]*$`, must not collide with a built-in |
| `label` | no | what the Settings list shows; defaults to the id |
| `description` | no | one line under the label |
| `suffix` | no | file-name stem: renders land as `<filePrefix>_<suffix>_<seed>.png`. Defaults to the id |
| `carriesStyle` | no | append the prompt after the graph's own positive prefix (booru-tag models) instead of replacing it |
| `graphs.fast` | yes | a JSON file name in the same folder |
| `graphs.high` | no | a second graph. Omitted means `high` mirrors `fast` and the result reports `quality: "fast"` |
| `defaults.width` / `.height` | no | 832 / 1216 |
| `defaults.steps` / `.cfg` | no | one number for both qualities, or `{ "fast": …, "high": … }` |
| `presets` | no | extra graphs that replace `quality` entirely, each `{ graph, steps?, cfg?, suffix?, width?, height? }` |
| `prompt` | no | a Markdown file in the same folder, appended to the system prompt while the workflow is enabled |

Graphs are ComfyUI *Save (API Format)* output, unmodified. The mutator addresses nodes by id,
so keep the skeleton in [graphs.md](graphs.md): `3` positive, `4` negative, `5` latent, `6`
sampler, `7` decode, `9` save. `21`/`22` are reserved for the hires pass.

## Prompt text

A workflow that needs the model to prompt it differently ships a prompt section. It is
appended after the component catalogue and before the harness rules, and only while the
workflow is enabled — a workflow without one costs no prompt tokens at all.

Write it as a `##` section that says what the lane is for, how prompts should be phrased, and
which settings (`high`, `preset`) mean what. `assets/prompt-anime.md` is a complete example.

This is also how the model learns the lane exists: the core tool description names only the
default workflow. A workflow without a prompt section renders fine if something asks for its id
explicitly, but a conversation will not discover it.

## Enable it

- **In the UI:** Settings → General → *Image workflows*. The row lists every workflow the
  harness found, with a switch per workflow and a delete button for the ones that came from a
  file. Refresh re-reads the directory.
- **In a profile:** `workflows: [real, sketch]` under the `dsh-genui` row of the profile's
  `cordis.patch.yml`.

Nothing restarts. The enabled set is a volatile config field, and the service, the prompt and
the Settings list all read it — and the registry — per request.

## Verify

```bash
curl -s http://127.0.0.1:3080/genui/health            # {"comfy":true,"workflows":["real","sketch"]}
curl -s http://127.0.0.1:3080/genui/workflows         # the list the Settings page renders
```

Then ask for it in a conversation:

```text
root = Stack([card])
query = Query("generate_image", {prompt: "a fountain pen on paper, ink bleeding into the fibres", lane: "sketch"}, {url: ""})
card = Card([GenImage(query.url, "Fountain pen on paper")])
```

## If it does not work

| Symptom | Reason |
|---|---|
| absent from the Settings list | the file is not in `workflowDir`, is not `.json`, or the harness log has `workflows: … was ignored: …` |
| `unknown workflow "sketch"` | the id in the request does not match the definition |
| `lane "sketch" is not enabled` | the definition exists but the enabled list does not include it |
| ComfyUI `value not in list` | the graph names a checkpoint/VAE/LoRA your ComfyUI does not have |
| a picture that ignores the prompt | the graph's positive node is not `3`, or `carriesStyle` is set on a caption model |

## Shipping a workflow in the bundle

For something the project itself should ship: put the graph(s) and the prompt section in
`assets/`, add a definition to `BUILTINS` in `src/host/workflows.ts` with the graphs imported
statically, extend the tests, rebuild `lib/`, and commit source plus build output. The rules
and the checklist are in [AGENTS.md](../AGENTS.md).
