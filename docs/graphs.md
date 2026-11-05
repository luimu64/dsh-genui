# Graph contract

A workflow is **data**: a definition naming one or two ComfyUI graphs and the settings they are
tuned for. Code never builds a graph from nothing and never writes a loader node — it clones a
template and changes the inputs a request owns. That is what lets a deployment add a model
without touching TypeScript.

- `assets/*.json` — the graphs the bundle ships.
- `src/host/workflows.ts` — the registry: built-in definitions, plus every `*.json` in the
  workflow directory. It also owns the edit lane's graph.
- `src/host/graphs.ts` — the mutation: prompt, negative, size, batch, seed, steps, CFG, file
  prefix, and the optional hires pair. It never asks which workflow it is drawing for.
- `src/host/config.ts` — `workflows` (enabled ids, volatile) and `workflowDir`.

How to add or change a workflow, and the definition format, is in
[add-workflow.md](add-workflow.md). This page is the contract a graph has to keep.

## The node skeleton

The mutator addresses nodes by id, so a template must keep these:

| Node | What it is | What the code writes |
|---|---|---|
| `1` | model loader (UNET / checkpoint) | never — it is the identity of the graph |
| `2` | text-encoder loader | never |
| `3` | positive `CLIPTextEncode` | the prompt (appended to the template's prefix when `carriesStyle`) |
| `4` | negative `CLIPTextEncode` | `negative`, the `nsfw` strip, and the text block unless `allowsText` |
| `5` | empty latent | `width`, `height`, `batch_size` |
| `6` | base `KSampler` | `seed`, `steps`, `cfg` |
| `7` | `VAEDecode` | its `samples` input, when the hires pass runs |
| `8` | VAE loader | never |
| `9` | `SaveImage` | `filename_prefix` |
| `21` | `LatentUpscaleBy` | added at runtime, only for a hires pass |
| `22` | refine `KSampler` | added at runtime, only for a hires pass |

Anything else in a template — a LoRA in the chain, a `Flux2Scheduler`, a `CFGGuider` — is left
exactly as committed. The hires pair is grafted onto whatever model and conditioning the base
sampler already uses.

The **edit** graph is different on purpose: it has no sampler of its own, it sizes itself from
the source image, and it runs a distilled few-step model through `SamplerCustomAdvanced`. Its
numbering is documented beside `EDIT_MODEL` in `src/host/workflows.ts`, and `buildEditGraph` is
the only code that touches it.

## Settings that follow the weights

A definition carries `width`, `height`, `steps`, `cfg`, `carriesStyle` and `allowsText` per graph. They are
defaults, not laws: a distilled four-step model wants `cfg: 1`; an undistilled one wants tens
of steps and a real CFG. Three rules are enforced on top of them:

- an explicit `steps` can never drop a `high` render below `HIGH_MIN_STEPS` (20), and an
  explicit `cfg` is clamped to `[HIGH_MIN_CFG, MAX_CFG]` — the floor is what undistilled
  checkpoints need;
- `carriesStyle: true` appends the prompt after the graph's own positive prefix, which is what
  booru-tag models expect. Caption models want the sentence verbatim, so they set it false;
- `allowsText` defaults to false. Unless it is true, every member of `TEXT_NEGATIVES` —
  `watermark`, `signature`, `text`, `logo`, `username`, `patreon username`, `web address`,
  `speech bubble`, `lettering`, `typography`, `stamp`, the language tags — is appended to node
  `4` after the request's own `negative` and the `nsfw` strip have been applied, so no caller
  can lose them. Only the moss caption models set it true: a photograph may legitimately show
  a sign that reads something.

A workflow that defines one graph runs it for both qualities; its results report
`quality: "fast"`, because that is what actually ran.

## The hires pass

`upscale: 1.05–2` (or `true` for 1.5) grows the latent with `LatentUpscaleBy`, re-samples it
with the same model/conditioning/sampler at denoise 0.45, and decodes the refined latent. The
second pass runs about 60% of the first pass's steps, and the factor is trimmed so the output
stays inside 4.2M pixels. It is off below 1.05: a full extra pass that changes nothing is not
worth a configuration flag.
