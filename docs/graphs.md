# Model graphs

Every render in this bundle comes from a ComfyUI **API-format graph** committed under
`assets/`. Code never builds a graph from nothing and never writes a loader node: it clones a
template and changes the inputs a request owns. That is what makes swapping the models a
data change rather than a patch.

- `assets/*.json` — the templates.
- `src/host/models.ts` — the registry: which template each lane/quality/preset uses, and the
  settings it is tuned for (size, steps, CFG, file-name stem, whether the positive prompt
  carries the template's style prefix).
- `src/shared/models.ts` — the ids alone, shared with the client's tool schema.
- `src/host/graphs.ts` — the mutation: prompt, negative, size, batch, seed, steps, CFG, file
  prefix, and the optional hires pair.
- `src/host/config.ts` — `workflows`: which lanes this deployment exposes. `['real']` is
  the default; `anime` is opt-in, and a disabled lane is refused before a graph is queued.

A workflow is a lane plus its prompt text. `real` is the two photo graphs.
`anime` is `anime.json`, `anime-hq.json`, the two preset graphs, the anime lane in the tool
surface, and `assets/prompt-anime.md`. The prompt section is appended by the host only when
the workflow is enabled, so a default install neither installs those checkpoints nor pays for
their prompt tokens.

## The node contract

Drawing templates follow a fixed skeleton. The mutator addresses nodes by id, so keep them
when you edit or replace a template:

| Node | What it is | What the code writes |
|---|---|---|
| `1` | model loader (UNET / checkpoint) | never — it is the identity of the graph |
| `2` | text-encoder loader | never |
| `3` | positive `CLIPTextEncode` | the prompt (appended to the template's prefix on style lanes) |
| `4` | negative `CLIPTextEncode` | `negative`, and the `nsfw` strip |
| `5` | empty latent | `width`, `height`, `batch_size` |
| `6` | base `KSampler` | `seed`, `steps`, `cfg` |
| `7` | `VAEDecode` | its `samples` input, when the hires pass runs |
| `8` | VAE loader | never |
| `9` | `SaveImage` | `filename_prefix` |
| `21` | `LatentUpscaleBy` | added at runtime, only for a hires pass |
| `22` | refine `KSampler` | added at runtime, only for a hires pass |

Anything else in a template — a LoRA in the chain, a `Flux2Scheduler`, a `CFGGuider` — is
left exactly as committed. The hires pair is grafted onto whatever model and conditioning the
base sampler already uses.

The **edit** template is different on purpose: it has no sampler of its own, it sizes itself
from the source image, and it runs a distilled few-step model through
`SamplerCustomAdvanced`. The ids `graphs.ts` writes for it are documented in the header of
`src/host/models.ts`.

## Settings that follow the weights

`ModelSpec` in `src/host/models.ts` carries `width`, `height`, `steps`, `cfg` and
`carriesStyle`. They are defaults, not laws: a distilled four-step model wants `cfg: 1`, an
undistilled one wants 30–50 steps and a real CFG. Two rules are enforced on top of them:

- an explicit `steps` can never drop a `high` render below `HIGH_MIN_STEPS` (20), and an
  explicit `cfg` is clamped to `[HIGH_MIN_CFG, MAX_CFG]` — the floor is what the undistilled
  checkpoints need;
- `carriesStyle: true` appends the prompt after the template's own positive prefix, which is
  what booru-tag models expect. Caption models want the sentence verbatim, so they set it
  false.

## Shipping your own models

1. Drop the graph in `assets/` (ComfyUI: *Save (API Format)*). Keep the node ids above.
2. Point `src/host/models.ts` at it: the `graph` import, plus `suffix`, size, steps, CFG and
   `carriesStyle`.
3. Change the ids in `src/shared/models.ts` only if you are adding a lane or a preset.
   Presets are anime-lane extras; a preset replaces `quality`, so give it the settings its
   author publishes and no cheaper variant.
4. Rewrite the sentences the model reads — the code is not what it follows. For a default
   workflow that is `genuiPromptOptions` in `src/client/library.tsx`; regenerate the
   catalogue with `bun run prompt` and adopt the diff into `assets/prompt-core.txt`. For the
   anime workflow it is `assets/prompt-anime.md`, which is hand-written and not generated.
5. `bun test`. `test/graphs.test.ts` builds every advertised lane, quality and preset, so a
   missing or malformed template fails there rather than under a user's prompt.

Nothing here is specific to the graphs that ship: `anime` and `real` are ids for two style
families, the two shipped presets are examples, and only `real` is on by default. If your ComfyUI has none of the
checkpoints the committed graphs name, the bundle will still start — a render fails with
ComfyUI's own "value not in list" error until you point the graph at a file you actually have.

## The hires pass

`upscale: 1.05–2` (or `true` for 1.5) grows the latent with `LatentUpscaleBy`, re-samples it
with the same model/conditioning/sampler at denoise 0.45, and decodes the refined latent. The
second pass runs about 60% of the first pass's steps, and the factor is trimmed so the output
stays inside 4.2M pixels. It is off below 1.05: a full extra pass that changes nothing is not
worth a configuration flag.
