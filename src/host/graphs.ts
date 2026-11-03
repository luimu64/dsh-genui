/**
 * ComfyUI graph mutation, ported from `genui-harness/src-tauri/src/comfy.rs`.
 *
 * The committed JSON files in `assets/` are the graphs. Code never writes a loader node, so
 * swapping quality is a template choice: the fast lanes use distilled checkpoints, the high
 * lanes the undistilled ones at their published settings.
 */
import animeTemplate from '../../assets/anime.json'
import animeHqTemplate from '../../assets/anime-hq.json'
import realTemplate from '../../assets/real.json'
import realHqTemplate from '../../assets/real-hq.json'
import editTemplate from '../../assets/edit.json'

export type Lane = 'anime' | 'real' | 'edit'
export type Quality = 'fast' | 'high'

export interface GraphNode {
  class_type: string
  inputs: Record<string, any>
}
export type Graph = Record<string, GraphNode>

/** Images in one batch. One queue item, one model load. */
export const MAX_BATCH = 8
/** A high render at a fast lane's step budget is the fast graph's work at 7x the load time. */
export const HIGH_MIN_STEPS = 20
/** Below this the undistilled checkpoints have no guidance to work with and return mush. */
export const HIGH_MIN_CFG = 1.5
/** Above this they overcook (burned contrast, clipped highlights) on both lanes. */
export const MAX_CFG = 9

export interface GenRequest {
  lane?: Lane
  prompt: string
  width?: number
  height?: number
  steps?: number
  cfg?: number
  negative?: string
  /** Ask for mature content: the template's `safe`/score negatives are dropped. */
  nsfw?: boolean
  quality?: Quality
  count?: number
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
  prefix: string
}

const LANES: readonly Lane[] = ['anime', 'real', 'edit']
const QUALITIES: readonly Quality[] = ['fast', 'high']

export function isLane(value: unknown): value is Lane {
  return typeof value === 'string' && (LANES as readonly string[]).includes(value)
}

export function isQuality(value: unknown): value is Quality {
  return typeof value === 'string' && (QUALITIES as readonly string[]).includes(value)
}

/**
 * Tolerant parse of the wire value: anything else is "no opinion", so a caller's typo falls
 * back to the lane/quality default instead of failing a render.
 */
export function parseQuality(value: unknown): Quality | undefined {
  return isQuality(value) ? value : undefined
}

export function parseLane(value: unknown): Lane | undefined {
  return isLane(value) ? value : undefined
}

function template(lane: Lane, quality: Quality): Graph {
  const source =
    lane === 'anime'
      ? quality === 'high'
        ? animeHqTemplate
        : animeTemplate
      : lane === 'real'
        ? quality === 'high'
          ? realHqTemplate
          : realTemplate
        : editTemplate
  return structuredClone(source) as unknown as Graph
}

export function qualityDefaults(lane: Lane, quality: Quality): LaneDefaults {
  const anime = lane === 'anime'
  const edit = lane === 'edit'
  const high = quality === 'high'

  const steps = edit ? 4 : anime ? (high ? 30 : 8) : high ? 50 : 4
  const cfg = edit ? 1 : anime ? (high ? 5 : 1) : high ? 3 : 1
  const width = !anime && !edit && high ? 992 : 832
  const height = !anime && !edit && high ? 1504 : 1216
  const prefix = edit
    ? 'harness_edit'
    : anime
      ? high
        ? 'harness_anime_hq'
        : 'harness_anime'
      : high
        ? 'harness_real_hq'
        : 'harness_real'

  return { width, height, steps, cfg, prefix }
}

/**
 * Explicit `steps` are honoured inside an envelope the quality can actually run: a high
 * render never drops to a fast lane's step budget. Explicit values above the floor pass
 * through untouched.
 */
export function effectiveSteps(req: GenRequest, lane: Lane, quality: Quality): number {
  const fallback = qualityDefaults(lane, quality).steps
  const asked = typeof req.steps === 'number' && Number.isFinite(req.steps) ? Math.round(req.steps) : undefined
  if (quality === 'fast') return asked ?? fallback
  return Math.max(asked ?? fallback, HIGH_MIN_STEPS)
}

/** Same rule for CFG: the undistilled checkpoints are floored and capped. */
export function effectiveCfg(req: GenRequest, lane: Lane, quality: Quality): number {
  const fallback = qualityDefaults(lane, quality).cfg
  const asked = typeof req.cfg === 'number' && Number.isFinite(req.cfg) ? req.cfg : undefined
  if (quality === 'fast') return asked ?? fallback
  return Math.min(Math.max(asked ?? fallback, HIGH_MIN_CFG), MAX_CFG)
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

export function buildGraph(req: GenRequest, seed: number, maxBatch = MAX_BATCH): Graph {
  const lane = parseLane(req.lane) ?? 'real'
  if (lane === 'edit') throw new Error('the edit lane needs edit_image (it takes a source image)')
  const quality = parseQuality(req.quality) ?? 'fast'
  const graph = template(lane, quality)

  // Both anime templates carry the official style prefix ("masterpiece, best quality,
  // score_7, safe, ") on node 3; the user prompt is appended to it. The real lane wants the
  // caption verbatim: it is a natural-language model.
  const carried = String(graph['3'].inputs.text ?? '')
  const prompt = req.prompt.trim()
  graph['3'].inputs.text = lane === 'anime' && !req.nsfw ? `${carried}${prompt}` : prompt

  if (req.nsfw) stripContentNegatives(graph)
  if (typeof req.negative === 'string') graph['4'].inputs.text = req.negative

  const defaults = qualityDefaults(lane, quality)
  graph['5'].inputs.width = req.width ?? defaults.width
  graph['5'].inputs.height = req.height ?? defaults.height
  graph['5'].inputs.batch_size = effectiveCount(req, maxBatch)
  graph['6'].inputs.seed = seed
  graph['6'].inputs.steps = effectiveSteps(req, lane, quality)
  graph['6'].inputs.cfg = effectiveCfg(req, lane, quality)
  graph['9'].inputs.filename_prefix = `${defaults.prefix}_${seed}`
  return graph
}

/**
 * The edit graph sizes itself from the source and carries no sampler of its own: a distilled
 * 4-step model driven through SamplerCustomAdvanced.
 *
 * `lora` is a name in `loras/`. The node is injected, never baked into the template, so an
 * unset LoRA keeps the committed graph byte-identical.
 */
export function buildEditGraph(req: EditGraphRequest): Graph {
  const graph = template('edit', 'fast')
  const seed = Math.trunc(req.seed)
  const steps = req.steps ?? qualityDefaults('edit', 'fast').steps
  graph['4'].inputs.image = req.sourceName
  graph['9'].inputs.text = req.prompt.trim()
  graph['14'].inputs.noise_seed = seed
  graph['16'].inputs.steps = steps
  graph['19'].inputs.filename_prefix = req.prefix ?? `harness_edit_${seed}`

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
