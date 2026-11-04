/**
 * The generation service: the one place that turns a validated request into a saved PNG.
 *
 * One Comfy job per batch (`batch_size = count`, one history entry with N images). Sequential
 * jobs would show frames progressively, but each one costs a model load, so a batch accepts
 * "all four appear together".
 */
import { randomInt } from 'node:crypto'
import {
  buildEditGraph,
  buildGraph,
  effectiveCount,
  effectiveUpscale,
  isLane,
  isPreset,
  isQuality,
  renderDefaults,
  type GenRequest,
  type Lane,
  type Preset,
  type Quality,
} from './graphs'
import { createComfyClient, type ComfyClient, type ImageRef } from './comfy'
import { EDIT_MODEL } from './models'
import { readRender, resolveSource, saveRender } from './images'
import type { Config as GenuiConfig } from './config'

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
  /** Which full checkpoint rendered this, when a preset was asked for. */
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
  generate(req: GenerateInput): Promise<GenResult>
  edit(req: EditInput): Promise<GenResult>
  health(): Promise<{ comfy: boolean }>
}

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
): GenuiService {
  const maxBatch = Math.max(1, Math.trunc(config.maxBatch || 8))
  const minPngBytes = Math.max(1, Math.trunc(config.minPngBytes || 30_000))
  const filePrefix = config.filePrefix?.trim() || 'genui'

  async function collect(images: ImageRef[], seed: number, steps: number, base: {
    prompt: string
    lane: Lane
    quality: Quality
    preset?: Preset
    upscale?: number
  }): Promise<GenImageOut[]> {
    const out: GenImageOut[] = []
    for (const image of images) {
      const bytes = await comfy.fetch(image)
      if (bytes.byteLength < minPngBytes) {
        throw new Error(
          `comfy returned a ${bytes.byteLength} byte png - failed render, not an image`,
        )
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
    if (out.length === 0) throw new Error('comfy finished with no images')
    return out
  }

  function result(images: GenImageOut[], meta: {
    prompt: string
    lane: Lane
    quality: Quality
    preset?: Preset
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
    async generate(input) {
      const prompt = requirePrompt(input.prompt, 'generate_image')
      const lane: Lane = isLane(input.lane) ? input.lane : 'real'
      if (lane === 'edit') throw new Error('the edit lane needs edit_image (it takes a source image)')
      const quality: Quality = isQuality(input.quality) ? input.quality : 'fast'
      const preset: Preset | undefined = isPreset(input.preset) ? input.preset : undefined
      if (preset && lane !== 'anime') {
        throw new Error(`preset "${preset}" is a full anime checkpoint: it needs lane "anime"`)
      }

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
      const graph = buildGraph(req, seed, maxBatch, filePrefix)
      const defaults = renderDefaults(lane, quality, preset, filePrefix)
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
      return result(out, { prompt, lane, quality, preset, upscale, seed, steps })
    },

    async edit(input) {
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
      return result(out, { prompt, lane: 'edit', quality: 'fast', seed, steps })
    },

    async health() {
      try {
        const res = await fetch(`${config.comfyBase.replace(/\/+$/, '')}/system_stats`, {
          signal: AbortSignal.timeout(2000),
        })
        return { comfy: res.ok }
      } catch {
        return { comfy: false }
      }
    },
  }
}
