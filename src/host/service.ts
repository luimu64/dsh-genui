/**
 * The generation service: the one place that turns a validated request into a saved PNG.
 *
 * One Comfy job per batch (`batch_size = count`, one history entry with N images). genui's
 * sequential jobs showed frames progressively; that costs a model load per frame, so v1
 * accepts "all four appear together".
 */
import { randomInt } from 'node:crypto'
import {
  buildEditGraph,
  buildGraph,
  effectiveCount,
  isLane,
  isQuality,
  qualityDefaults,
  type GenRequest,
  type Lane,
  type Quality,
} from './graphs'
import { createComfyClient, type ComfyClient, type ImageRef } from './comfy'
import { readRender, resolveSource, saveRender } from './images'

export interface GenuiConfig {
  comfyBase: string
  imagesDir: string
  maxBatch: number
  pollMs: number
  minPngBytes: number
}

export interface GenerateInput {
  lane?: unknown
  quality?: unknown
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
const HIGH_TIMEOUT_MS = 900_000

export function imageUrl(file: string): string {
  return `/genui/images/${encodeURIComponent(file)}`
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

  async function collect(images: ImageRef[], seed: number, steps: number, base: {
    prompt: string
    lane: Lane
    quality: Quality
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
        seed,
        steps,
        file,
      })
    }
    if (out.length === 0) throw new Error('comfy finished with no images')
    return out
  }

  function result(images: GenImageOut[], meta: { prompt: string; lane: Lane; quality: Quality; seed: number; steps: number }): GenResult {
    const first = images[0]
    return {
      url: first.url,
      file: first.file,
      prompt: meta.prompt,
      lane: meta.lane,
      quality: meta.quality,
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
      }

      const seed = randomInt(0, 2 ** 32)
      const graph = buildGraph(req, seed, maxBatch)
      const promptId = await comfy.queue(graph)
      const timeout = quality === 'high' ? HIGH_TIMEOUT_MS : FAST_TIMEOUT_MS
      const images = await comfy.wait(promptId, timeout, config.pollMs)
      const steps = Number(graph['6'].inputs.steps)
      const out = await collect(images, seed, steps, { prompt, lane, quality })
      return result(out, { prompt, lane, quality, seed, steps })
    },

    async edit(input) {
      const prompt = requirePrompt(input.prompt, 'edit_image')
      const source = resolveSource(config.imagesDir, stringOr(input.source))
      const bytes = await readRender(config.imagesDir, source)
      const uploaded = await comfy.upload(source, bytes)

      const seedFallback = qualityDefaults('edit', 'fast')
      const seed = Math.trunc(numberOr(input.seed, randomInt(0, 2 ** 32)) as number)
      const steps = Math.trunc(numberOr(input.steps, seedFallback.steps) as number)
      const graph = buildEditGraph({
        prompt,
        sourceName: uploaded,
        seed,
        steps,
        lora: stringOr(input.lora),
        loraStrength: numberOr(input.loraStrength, numberOr(input.lora_strength, undefined)),
      })

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
