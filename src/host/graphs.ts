/**
 * ComfyUI graph mutation.
 *
 * A request never builds a graph from scratch: the workflow registry hands this module one
 * template plus the settings it is tuned for, and the mutation changes only the inputs a
 * request owns - prompt, negative, size, batch, seed, steps, cfg, file prefix - plus the
 * optional hires pair. No loader node is ever written here, so swapping or adding a model is
 * a workflow definition, not a patch to this file.
 */
import type { QualityId } from '../shared/models'
import { EDIT_MODEL, type Graph, type WorkflowModel } from './workflows'

export type { Graph, GraphNode } from './workflows'
export type { QualityId as Quality } from '../shared/models'

/** Images in one batch. One queue item, one model load. */
export const MAX_BATCH = 8
/** A high render at a fast graph's step budget is that graph's work at the load time. */
export const HIGH_MIN_STEPS = 20
/** Below this an undistilled checkpoint has no guidance to work with and returns mush. */
export const HIGH_MIN_CFG = 1.5
/** Above this they overcook (burned contrast, clipped highlights). */
export const MAX_CFG = 9
/**
 * A second sampler pass over an upscaled latent. Below ~1.05 the extra pass costs a full
 * generation and changes nothing, so it counts as off.
 */
export const MIN_UPSCALE = 1.05
export const MAX_UPSCALE = 2
/**
 * The second pass works on a latent 2.25x the size at 1.5x scale. Past this it is filling
 * VRAM for pixels the model cannot resolve anyway, so the factor is trimmed to fit.
 */
export const MAX_HIRES_PIXELS = 4_200_000
/** Refine, do not redraw: enough denoise to fix the upscale, not enough to move the subject. */
export const HIRES_DENOISE = 0.45
/** Node ids the hires pass adds. Templates use 1-20 for their own graph. */
const UPSCALE_NODE = '21'
const REFINE_NODE = '22'

/** Default stem for render file names, overridable with the `filePrefix` config key. */
export const DEFAULT_FILE_PREFIX = 'genui'

export interface GenRequest {
  lane?: string
  prompt: string
  width?: number
  height?: number
  steps?: number
  cfg?: number
  negative?: string
  /** Ask for mature content: the template's `safe`/score negatives are dropped. */
  nsfw?: boolean
  quality?: QualityId
  count?: number
  /** A workflow-defined preset: its own graph at its own settings. */
  preset?: string
  /** Second pass over an upscaled latent: `true` means 1.5x, or pass the factor itself. */
  upscale?: boolean | number
}

export interface EditGraphRequest {
  prompt: string
  /** Server-side name LoadImage can reference (already uploaded). */
  sourceName: string
  seed: number
  steps?: number
  prefix?: string
  lora?: string
  loraStrength?: number
}

export interface LaneDefaults {
  width: number
  height: number
  steps: number
  cfg: number
  /** Full `filename_prefix` stem, before the seed. */
  prefix: string
}

/**
 * The folder inside ComfyUI’s `output/` that a run writes into: `ds-<YYYY-MM-DD>`, in
 * local time. SaveImage treats a slash in `filename_prefix` as a subfolder, so a day of
 * renders sits together under one dated folder instead of in the flat output root.
 */
export function dateFolder(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `ds-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** `ds-2026-11-05/genui_real_42` — the dated folder in front of the file stem. */
export function savePrefix(stem: string, now: Date = new Date()): string {
  return `${dateFolder(now)}/${stem}`
}

/** The settings a resolved model is tuned for, at the configured file prefix. */
export function defaultsFor(model: WorkflowModel, filePrefix = DEFAULT_FILE_PREFIX): LaneDefaults {
  return {
    width: model.width,
    height: model.height,
    steps: model.steps,
    cfg: model.cfg,
    prefix: `${filePrefix}_${model.suffix}`,
  }
}

/**
 * Explicit `steps` are honoured inside an envelope the quality can actually run: a high
 * render never drops to a fast graph's step budget. Explicit values above the floor pass
 * through untouched.
 */
export function effectiveSteps(req: GenRequest, model: WorkflowModel, quality: QualityId): number {
  const asked = typeof req.steps === 'number' && Number.isFinite(req.steps) ? Math.round(req.steps) : undefined
  if (req.preset || quality === 'fast') return Math.max(asked ?? model.steps, 1)
  return Math.max(asked ?? model.steps, HIGH_MIN_STEPS)
}

/** Same rule for CFG: undistilled checkpoints are floored and capped. */
export function effectiveCfg(req: GenRequest, model: WorkflowModel, quality: QualityId): number {
  const asked = typeof req.cfg === 'number' && Number.isFinite(req.cfg) ? req.cfg : undefined
  if (req.preset || quality === 'fast') return asked ?? model.cfg
  return Math.min(Math.max(asked ?? model.cfg, HIGH_MIN_CFG), MAX_CFG)
}

/**
 * How far to scale the latent before the refine pass. `true` is 1.5x; a number is used as the
 * factor. Anything under MIN_UPSCALE means "off", and the factor is trimmed so the second pass
 * stays inside MAX_HIRES_PIXELS.
 */
export function effectiveUpscale(req: GenRequest, width: number, height: number): number {
  const raw = req.upscale
  const asked = raw === true ? 1.5 : typeof raw === 'number' && Number.isFinite(raw) ? raw : 1
  if (asked < MIN_UPSCALE) return 1
  const room = Math.sqrt(MAX_HIRES_PIXELS / Math.max(1, width * height))
  const factor = Math.min(asked, MAX_UPSCALE, Math.max(1, room))
  if (factor < MIN_UPSCALE) return 1
  return Math.round(factor * 100) / 100
}

export function effectiveCount(req: GenRequest, maxBatch = MAX_BATCH): number {
  const asked = typeof req.count === 'number' && Number.isFinite(req.count) ? Math.round(req.count) : 1
  return Math.min(Math.max(asked, 1), Math.max(1, maxBatch))
}

/** Drop negative tokens that are content judgements rather than quality ones. */
export function stripContentNegatives(graph: Graph): void {
  const negative = String(graph['4']?.inputs?.text ?? '')
  const kept = negative
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => !['score_1', 'score_2', 'score_3', 'safe', 'nsfw'].includes(token))
  graph['4'].inputs.text = kept.join(', ')
}

export function buildGraph(
  model: WorkflowModel,
  req: GenRequest,
  seed: number,
  maxBatch = MAX_BATCH,
  filePrefix = DEFAULT_FILE_PREFIX,
): Graph {
  const graph = structuredClone(model.graph) as Graph
  const quality = req.quality ?? 'fast'

  // A booru-tag template carries its style prefix on node 3; the user prompt is appended to
  // it. A caption model wants the text verbatim.
  const carried = String(graph['3']?.inputs?.text ?? '')
  const prompt = req.prompt.trim()
  graph['3'].inputs.text = model.carriesStyle && !req.nsfw ? `${carried}${prompt}` : prompt

  if (req.nsfw) stripContentNegatives(graph)
  if (typeof req.negative === 'string') graph['4'].inputs.text = req.negative

  const defaults = defaultsFor(model, filePrefix)
  const width = req.width ?? defaults.width
  const height = req.height ?? defaults.height
  const steps = effectiveSteps(req, model, quality)
  graph['5'].inputs.width = width
  graph['5'].inputs.height = height
  graph['5'].inputs.batch_size = effectiveCount(req, maxBatch)
  graph['6'].inputs.seed = seed
  graph['6'].inputs.steps = steps
  graph['6'].inputs.cfg = effectiveCfg(req, model, quality)
  graph['9'].inputs.filename_prefix = savePrefix(`${defaults.prefix}_${seed}`)

  const upscale = effectiveUpscale(req, width, height)
  if (upscale > 1) {
    const first = graph['6']
    // Same model, conditioning and sampler as the base pass, from a latent the upscaler grew.
    // Only the seed, the step budget and the denoise differ.
    graph[UPSCALE_NODE] = {
      class_type: 'LatentUpscaleBy',
      inputs: {
        samples: ['6', 0],
        scale_by: upscale,
        upscale_method: 'nearest-exact',
      },
    }
    graph[REFINE_NODE] = {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: Math.max(8, Math.round(steps * 0.6)),
        cfg: first.inputs.cfg,
        sampler_name: first.inputs.sampler_name,
        scheduler: first.inputs.scheduler,
        denoise: HIRES_DENOISE,
        model: first.inputs.model,
        positive: first.inputs.positive,
        negative: first.inputs.negative,
        latent_image: [UPSCALE_NODE, 0],
      },
    }
    graph['7'].inputs.samples = [REFINE_NODE, 0]
  }
  return graph
}

/**
 * The edit graph sizes itself from the source and carries no sampler of its own: a distilled
 * few-step model driven through SamplerCustomAdvanced.
 *
 * `lora` is a name in ComfyUI's `loras/`. The node is injected, never baked into the
 * template, so an unset LoRA keeps the committed graph byte-identical.
 */
export function buildEditGraph(req: EditGraphRequest, filePrefix = DEFAULT_FILE_PREFIX): Graph {
  const graph = structuredClone(EDIT_MODEL.graph) as Graph
  const seed = Math.trunc(req.seed)
  const steps = req.steps ?? EDIT_MODEL.steps
  graph['4'].inputs.image = req.sourceName
  graph['9'].inputs.text = req.prompt.trim()
  graph['14'].inputs.noise_seed = seed
  graph['16'].inputs.steps = steps
  graph['19'].inputs.filename_prefix =
    req.prefix ?? savePrefix(`${filePrefix}_${EDIT_MODEL.suffix}_${seed}`)

  const lora = req.lora?.trim()
  if (lora) {
    graph['20'] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        lora_name: lora,
        strength_model: req.loraStrength ?? 0.8,
        model: ['1', 0],
      },
    }
    graph['13'].inputs.model = ['20', 0]
  }
  return graph
}
