/**
 * The generation service: the one place that turns a validated request into a saved PNG.
 *
 * One Comfy job per batch (`batch_size = count`, one history entry with N images). Sequential
 * jobs would show frames progressively, but each one costs a model load, so a batch accepts
 * "all four appear together".
 *
 * The service knows no workflows of its own: the registry says which lane ids exist and which
 * graph each one runs, and the config says which of them this deployment enabled. Both are read
 * per request, so the Settings page can enable, disable or drop a workflow without a restart.
 */
import { randomInt } from 'node:crypto'
import {
  buildEditGraph,
  buildGraph,
  defaultsFor,
  effectiveCount,
  effectiveUpscale,
  type GenRequest,
} from './graphs'
import { createComfyClient, type ComfyClient, type ImageRef } from './comfy'
import {
  createWorkflowRegistry,
  EDIT_MODEL,
  type WorkflowRegistry,
  type WorkflowSummary,
} from './workflows'
import { readRender, resolveSource, saveRender } from './images'
import { createRenderIndex, safeKey, type IndexedRender, type RenderIndex } from './renderIndex'
import { isQualityId } from '../shared/models'
import { workflowsOf, type Config as GenuiConfig } from './config'

export type { Config as GenuiConfig } from './config'

export interface GenerateInput {
  lane?: unknown
  quality?: unknown
  preset?: unknown
  upscale?: unknown
  prompt: unknown
  count?: unknown
  steps?: unknown
  cfg?: unknown
  width?: unknown
  height?: unknown
  negative?: unknown
  nsfw?: unknown
}

export interface EditInput {
  prompt: unknown
  source?: unknown
  steps?: unknown
  seed?: unknown
  lora?: unknown
  loraStrength?: unknown
  lora_strength?: unknown
}

export interface GenImageOut {
  url: string
  prompt: string
  lane: string
  quality: string
  /** Which preset graph rendered this, when a preset was asked for. */
  preset?: string
  /** The hires factor, present only when a refine pass ran. */
  upscale?: number
  seed: number
  steps: number
  file: string
}

export interface GenResult {
  url: string
  file: string
  prompt: string
  lane: string
  quality: string
  preset?: string
  upscale?: number
  seed: number
  steps: number
  images: GenImageOut[]
}

export interface GenuiService {
  /**
   * `key` is the browser's cache key for this request. When it is sent, the render is
   * recorded against it in the host-side index, so the picture can be found again after the
   * browser's own cache is gone.
   */
  generate(req: GenerateInput, key?: string): Promise<GenResult>
  edit(req: EditInput, key?: string): Promise<GenResult>
  /** What this machine already rendered for a browser key, if anything. */
  cached(keys: string[]): Record<string, IndexedRender>
  health(): Promise<{ comfy: boolean; workflows: string[] }>
  /** Every known workflow with the enabled flag folded in. */
  workflows(): WorkflowSummary[]
  /** Delete a user-added workflow definition. A built-in is refused. */
  removeWorkflow(id: string): boolean
  /** The registry, for prompt sections and raw definitions. */
  readonly registry: WorkflowRegistry
}

/** One lookup covers a batch aggregate plus every frame of it. */
const MAX_LOOKUP_KEYS = 16

const FAST_TIMEOUT_MS = 240_000
/** A full checkpoint plus a refine pass: slower than fast, far from the high lane's 50 steps. */
const PRESET_TIMEOUT_MS = 600_000
const HIGH_TIMEOUT_MS = 900_000

/** Where the client fetches a saved render. Mirrors the route in `routes.ts`. */
export const IMAGE_ROUTE = '/genui/images'

export function imageUrl(file: string): string {
  return `${IMAGE_ROUTE}/${encodeURIComponent(file)}`
}

function numberOr(value: unknown, fallback: number | undefined): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : fallback
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function requirePrompt(value: unknown, tool: string): string {
  const prompt = typeof value === 'string' ? value.trim() : ''
  if (!prompt) throw new Error(`${tool} needs a prompt`)
  return prompt
}

export function createGenuiService(
  config: GenuiConfig,
  comfy: ComfyClient = createComfyClient({ base: config.comfyBase, pollMs: config.pollMs }),
  registry: WorkflowRegistry = createWorkflowRegistry({ dir: config.workflowDir }),
  index: RenderIndex = createRenderIndex(config.imagesDir),
): GenuiService {
  const maxBatch = Math.max(1, Math.trunc(config.maxBatch || 8))
  const minPngBytes = Math.max(1, Math.trunc(config.minPngBytes || 30_000))
  const filePrefix = config.filePrefix?.trim() || 'genui'
  // Read per request: the Settings page writes this volatile field while the harness runs.
  const workflowsNow = () => workflowsOf(config)

  /**
   * Record a finished render against the browser's key. Best effort: a request without a
   * key (an old client) simply is not indexed, and a read-only imagesDir does not fail the
   * render - the picture is saved either way.
   */
  const remember = (key: string | undefined, render: GenResult) => {
    const safe = safeKey(key)
    if (!safe) return
    index.remember(safe, {
      url: render.url,
      file: render.file,
      prompt: render.prompt,
      lane: render.lane,
      quality: render.quality,
      preset: render.preset,
      upscale: render.upscale,
      seed: render.seed,
      steps: render.steps,
      images: render.images.map((image) => ({
        url: image.url,
        file: image.file,
        seed: image.seed,
        prompt: image.prompt,
      })),
    })
  }

  async function collect(images: ImageRef[], seed: number, steps: number, base: {
    prompt: string
    lane: string
    quality: string
    preset?: string
    upscale?: number
  }): Promise<GenImageOut[]> {
    const out: GenImageOut[] = []
    const rejected: string[] = []
    for (const image of images) {
      const bytes = await comfy.fetch(image)
      // A frame that came back as noise-sized bytes is dropped, not fatal: a batch of four
      // used to fail as a whole because one sample was bad, which reads as "the batch is
      // broken" when three good pictures are sitting right there. A single-image request
      // still throws below, because then there is nothing to show.
      if (bytes.byteLength < minPngBytes) {
        rejected.push(`${image.filename} (${bytes.byteLength} bytes)`)
        continue
      }
      const file = await saveRender(config.imagesDir, image.filename, bytes)
      out.push({
        url: imageUrl(file),
        prompt: base.prompt,
        lane: base.lane,
        quality: base.quality,
        ...(base.preset ? { preset: base.preset } : {}),
        ...(base.upscale && base.upscale > 1 ? { upscale: base.upscale } : {}),
        seed,
        steps,
        file,
      })
    }
    if (out.length === 0) {
      throw new Error(
        rejected.length === 0
          ? 'comfy finished with no images'
          : `every frame of the batch came back unusable (${rejected.join(', ')}) - failed render, not an image`,
      )
    }
    return out
  }

  function result(images: GenImageOut[], meta: {
    prompt: string
    lane: string
    quality: string
    preset?: string
    upscale?: number
    seed: number
    steps: number
  }): GenResult {
    const first = images[0]
    return {
      url: first.url,
      file: first.file,
      prompt: meta.prompt,
      lane: meta.lane,
      quality: meta.quality,
      ...(meta.preset ? { preset: meta.preset } : {}),
      ...(meta.upscale && meta.upscale > 1 ? { upscale: meta.upscale } : {}),
      seed: meta.seed,
      steps: meta.steps,
      images,
    }
  }

  return {
    registry,

    async generate(input, key) {
      const prompt = requirePrompt(input.prompt, 'generate_image')
      const lane = stringOr(input.lane)?.trim() || 'real'
      if (lane === 'edit') throw new Error('the edit lane needs edit_image (it takes a source image)')

      // Existence first: "no such workflow" is a different mistake from "it is switched off",
      // and the two messages send the reader to different places.
      const workflow = registry.get(lane)
      if (!workflow) {
        const known = registry.list().map((candidate) => candidate.id).join(', ')
        throw new Error(`unknown workflow "${lane}" (known workflows: ${known})`)
      }
      const enabled = workflowsNow()
      if (!enabled.includes(lane)) {
        throw new Error(
          `lane "${lane}" is not enabled in this deployment (enabled workflows: ${enabled.join(', ')})`,
        )
      }

      const asked = isQualityId(input.quality) ? input.quality : 'fast'
      const preset = stringOr(input.preset)?.trim() || undefined
      if (preset && !workflow.presets[preset]) {
        const known = Object.keys(workflow.presets).join(', ')
        throw new Error(
          `workflow "${lane}" has no preset "${preset}"${known ? ` (has: ${known})` : ' (it defines none)'}`,
        )
      }
      // A workflow that ships one graph runs the same settings for both qualities; reporting
      // the quality it actually ran keeps the metadata and the cache key honest.
      const quality = !preset && workflow.high === workflow.fast ? 'fast' : asked
      const model = preset ? workflow.presets[preset] : workflow[quality]

      const req: GenRequest = {
        lane,
        quality,
        prompt,
        count: effectiveCount({ prompt, count: numberOr(input.count, 1) }, maxBatch),
        steps: numberOr(input.steps, undefined),
        cfg: numberOr(input.cfg, undefined),
        width: numberOr(input.width, undefined),
        height: numberOr(input.height, undefined),
        negative: stringOr(input.negative),
        nsfw: input.nsfw === true,
        preset,
        upscale: input.upscale as boolean | number | undefined,
      }

      const seed = randomInt(0, 2 ** 32)
      const graph = buildGraph(model, req, seed, maxBatch, filePrefix)
      const defaults = defaultsFor(model, filePrefix)
      const upscale = effectiveUpscale(req, req.width ?? defaults.width, req.height ?? defaults.height)
      const promptId = await comfy.queue(graph)
      const timeout = quality === 'high'
        ? HIGH_TIMEOUT_MS
        : preset || upscale > 1
          ? PRESET_TIMEOUT_MS
          : FAST_TIMEOUT_MS
      const images = await comfy.wait(promptId, timeout, config.pollMs)
      const steps = Number(graph['6'].inputs.steps)
      const out = await collect(images, seed, steps, { prompt, lane, quality, preset, upscale })
      const answer = result(out, { prompt, lane, quality, preset, upscale, seed, steps })
      remember(key, answer)
      return answer
    },

    async edit(input, key) {
      const prompt = requirePrompt(input.prompt, 'edit_image')
      const source = resolveSource(config.imagesDir, stringOr(input.source))
      const bytes = await readRender(config.imagesDir, source)
      const uploaded = await comfy.upload(source, bytes)

      const seed = Math.trunc(numberOr(input.seed, randomInt(0, 2 ** 32)) as number)
      const steps = Math.trunc(numberOr(input.steps, EDIT_MODEL.steps) as number)
      const graph = buildEditGraph({
        prompt,
        sourceName: uploaded,
        seed,
        steps,
        lora: stringOr(input.lora),
        loraStrength: numberOr(input.loraStrength, numberOr(input.lora_strength, undefined)),
      }, filePrefix)

      const promptId = await comfy.queue(graph)
      const images = await comfy.wait(promptId, FAST_TIMEOUT_MS, config.pollMs)
      const out = await collect(images, seed, steps, { prompt, lane: 'edit', quality: 'fast' })
      const answer = result(out, { prompt, lane: 'edit', quality: 'fast', seed, steps })
      remember(key, answer)
      return answer
    },

    /**
     * A render this machine made, under the key the browser hashed. `images` is filled in for
     * the batch aggregate; a frame entry is a one-element set.
     */
    cached(keys) {
      const out: Record<string, IndexedRender> = {}
      for (const asked of keys.slice(0, MAX_LOOKUP_KEYS)) {
        const key = safeKey(asked)
        if (!key) continue
        const hit = index.lookup(key)
        if (hit) out[key] = hit
      }
      return out
    },

    async health() {
      const enabled = workflowsNow()
      try {
        const res = await fetch(`${config.comfyBase.replace(/\/+$/, '')}/system_stats`, {
          signal: AbortSignal.timeout(2000),
        })
        return { comfy: res.ok, workflows: enabled }
      } catch {
        return { comfy: false, workflows: enabled }
      }
    },

    workflows() {
      return registry.summaries(workflowsNow())
    },

    removeWorkflow(id) {
      // The definition only: dropping the id from the enabled list is the settings form's
      // job, because that write belongs to whoever owns the config document.
      return registry.remove(id)
    },
  }
}
