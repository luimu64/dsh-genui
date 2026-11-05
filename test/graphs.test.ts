import { describe, expect, test } from 'bun:test'
import {
  MAX_BATCH,
  buildEditGraph,
  buildGraph,
  dateFolder,
  defaultsFor,
  effectiveUpscale,
} from '../src/host/graphs'
import { createWorkflowRegistry } from '../src/host/workflows'

/** The shipped definitions; the directory does not exist, so only built-ins load. */
const registry = createWorkflowRegistry({ dir: '/nonexistent/genui-workflows' })
const real = registry.get('real')!
const anime = registry.get('anime')!
const moss = registry.get('moss')!

describe('buildGraph', () => {
  test('real fast uses 4 steps, cfg 1, 832x1216, seed in the prefix', () => {
    const graph = buildGraph(real.fast, { lane: 'real', quality: 'fast', prompt: 'a red fox in snow', count: 1 }, 42)
    expect(graph['5'].inputs.width).toBe(832)
    expect(graph['5'].inputs.height).toBe(1216)
    expect(graph['6'].inputs.steps).toBe(4)
    expect(graph['6'].inputs.cfg).toBe(1)
    expect(graph['6'].inputs.seed).toBe(42)
    expect(graph['9'].inputs.filename_prefix).toBe(`${dateFolder()}/genui_real_42`)
  })

  test('a style-carrying workflow prepends the template prefix', () => {
    const graph = buildGraph(anime.fast, { lane: 'anime', quality: 'fast', prompt: '1girl, red hair', count: 1 }, 7)
    expect(graph['3'].inputs.text).toContain('masterpiece')
    expect(graph['3'].inputs.text).toContain('1girl, red hair')
  })

  test('a caption workflow does not', () => {
    const graph = buildGraph(real.fast, { lane: 'real', prompt: 'a red fox', count: 1 }, 7)
    expect(graph['3'].inputs.text).toBe('a red fox')
  })

  test('nsfw drops score negatives', () => {
    const graph = buildGraph(anime.fast, { lane: 'anime', prompt: '1girl, nude', nsfw: true, count: 1 }, 7)
    expect(graph['4'].inputs.text).not.toContain('score_1')
  })

  test('every non-moss workflow carries the text block in its negative', () => {
    const graph = buildGraph(anime.fast, { lane: 'anime', prompt: '1girl', count: 1 }, 7)
    expect(graph['4'].inputs.text).toContain('watermark')
    expect(graph['4'].inputs.text).toContain('signature')
    expect(graph['4'].inputs.text).toContain('speech bubble')
  })

  test('a request negative does not remove the text block', () => {
    const graph = buildGraph(
      anime.fast,
      { lane: 'anime', prompt: '1girl', negative: 'blurry, low quality', count: 1 },
      7,
    )
    expect(graph['4'].inputs.text.startsWith('blurry, low quality')).toBe(true)
    expect(graph['4'].inputs.text).toContain('watermark')
  })

  test('nsfw keeps the text block', () => {
    const graph = buildGraph(anime.fast, { lane: 'anime', prompt: '1girl, nude', nsfw: true, count: 1 }, 7)
    expect(graph['4'].inputs.text).toContain('watermark')
  })

  test('moss is allowed to letter the picture, so its negative stays untouched', () => {
    const graph = buildGraph(real.fast, { prompt: 'a shop sign reading OPEN', count: 1 }, 7)
    expect(graph['4'].inputs.text).toBe('')
    const asked = buildGraph(real.fast, { prompt: 'x', negative: 'nsfw', count: 1 }, 7)
    expect(asked['4'].inputs.text).toBe('nsfw')
  })

  test('moss fast is the template setting: 25 steps, cfg 2.5, er_sde', () => {
    const graph = buildGraph(moss.fast, { lane: 'moss', prompt: 'a shop sign reading "OPEN"', count: 1 }, 11)
    expect(graph['6'].inputs.steps).toBe(25)
    expect(graph['6'].inputs.cfg).toBe(2.5)
    expect(graph['6'].inputs.sampler_name).toBe('er_sde')
    expect(graph['9'].inputs.filename_prefix).toBe(`${dateFolder()}/genui_moss_11`)
  })

  test('moss high is the model card setting, with skip-layer guidance on layer 22', () => {
    const graph = buildGraph(moss.high, { lane: 'moss', quality: 'high', prompt: 'x', count: 1 }, 11)
    expect(graph['6'].inputs.steps).toBe(50)
    expect(graph['6'].inputs.cfg).toBe(3)
    expect(graph['6'].inputs.sampler_name).toBe('euler')
    expect(graph['6'].inputs.model).toEqual(['11', 0])
    expect(graph['11'].class_type).toBe('SkipLayerGuidanceDiTSimple')
    expect(graph['11'].inputs.single_layers).toBe('22')
    expect(graph['5'].inputs.width).toBe(992)
    expect(graph['5'].inputs.height).toBe(1504)
  })

  test('count clamps to maxBatch', () => {
    const graph = buildGraph(real.fast, { prompt: 'x', count: 99 }, 1)
    expect(graph['5'].inputs.batch_size).toBe(MAX_BATCH)
  })

  test('an untouched build does not mutate the definition', () => {
    const first = buildGraph(real.fast, { prompt: 'first', count: 1 }, 1)
    const second = buildGraph(real.fast, { prompt: 'second', count: 1 }, 2)
    expect(second['3'].inputs.text).toBe('second')
    expect(first['6'].inputs.seed).toBe(1)
  })
})

describe('presets', () => {
  test('a preset runs its own graph and settings', () => {
    const graph = buildGraph(
      anime.presets.miaoharem,
      { lane: 'anime', preset: 'miaoharem', prompt: '1girl, red hair', count: 1 },
      5,
    )
    expect(graph['1'].inputs.unet_name).toBe('MiaoMiaoHarem_Anima_1.6.safetensors')
    expect(graph['6'].inputs.steps).toBe(30)
    expect(graph['6'].inputs.cfg).toBe(4.5)
    expect(graph['6'].inputs.sampler_name).toBe('euler')
    expect(graph['9'].inputs.filename_prefix).toBe(`${dateFolder()}/genui_anima_miao_5`)
  })

  test('dasiwa keeps the anime stack', () => {
    const graph = buildGraph(
      anime.presets.dasiwa,
      { lane: 'anime', preset: 'dasiwa', prompt: 'x', count: 1 },
      6,
    )
    expect(graph['1'].inputs.unet_name).toBe('dasiwaAnima_obsidianArchivesV2.safetensors')
    expect(graph['2'].inputs.clip_name).toBe('qwen_3_06b_base.safetensors')
    expect(graph['8'].inputs.vae_name).toBe('qwen_image_vae.safetensors')
    expect(graph['9'].inputs.filename_prefix).toBe(`${dateFolder()}/genui_anima_dasiwa_6`)
  })

  test('defaultsFor reports what a definition is tuned for', () => {
    expect(defaultsFor(anime.presets.dasiwa)).toEqual({
      width: 832,
      height: 1216,
      steps: 30,
      cfg: 4.5,
      prefix: 'genui_anima_dasiwa',
    })
  })

  test('the real high graph is 992x1504, 50 steps, cfg 3', () => {
    expect(defaultsFor(real.high)).toEqual({
      width: 992,
      height: 1504,
      steps: 50,
      cfg: 3,
      prefix: 'genui_real_hq',
    })
  })
})

describe('hires pass', () => {
  test('adds an upscale and a refine sampler, and decodes the refined latent', () => {
    const graph = buildGraph(
      anime.presets.miaoharem,
      { lane: 'anime', preset: 'miaoharem', quality: 'high', prompt: 'x', upscale: 1.5, count: 1 },
      9,
    )
    expect(graph['21'].class_type).toBe('LatentUpscaleBy')
    expect(graph['21'].inputs.scale_by).toBe(1.5)
    expect(graph['22'].class_type).toBe('KSampler')
    expect(graph['22'].inputs.latent_image).toEqual(['21', 0])
    expect(graph['22'].inputs.denoise).toBe(0.45)
    expect(graph['22'].inputs.model).toEqual(graph['6'].inputs.model)
    expect(graph['7'].inputs.samples).toEqual(['22', 0])
  })

  test('`true` means 1.5x and the second pass is shorter than the first', () => {
    const graph = buildGraph(real.fast, { prompt: 'x', upscale: true, count: 1 }, 9)
    expect(graph['21'].inputs.scale_by).toBe(1.5)
    expect(Number(graph['22'].inputs.steps)).toBe(Math.max(8, Math.round(4 * 0.6)))
  })

  test('no upscale leaves the graph without the extra nodes', () => {
    const graph = buildGraph(real.fast, { prompt: 'x', count: 1 }, 9)
    expect(graph['21']).toBeUndefined()
    expect(graph['22']).toBeUndefined()
    expect(graph['7'].inputs.samples).toEqual(['6', 0])
  })

  test('the refine pass keeps a template LoRA in the chain', () => {
    const graph = buildGraph(real.fast, { prompt: 'x', upscale: 1.5, count: 1 }, 9)
    expect(graph['6'].inputs.model).toEqual(['10', 0])
    expect(graph['22'].inputs.model).toEqual(['10', 0])
  })
})

describe('effectiveUpscale', () => {
  test('anything under 1.05 counts as off', () => {
    expect(effectiveUpscale({ prompt: 'x', upscale: 1.02 }, 832, 1216)).toBe(1)
    expect(effectiveUpscale({ prompt: 'x', upscale: false }, 832, 1216)).toBe(1)
  })

  test('clamps to 2x and trims to the pixel budget', () => {
    expect(effectiveUpscale({ prompt: 'x', upscale: 4 }, 832, 1216)).toBe(2)
    // 992x1504 has no room for 2x inside 4.2M pixels.
    const trimmed = effectiveUpscale({ prompt: 'x', upscale: 2 }, 992, 1504)
    expect(trimmed).toBeLessThan(2)
    expect(992 * trimmed * 1504 * trimmed).toBeLessThanOrEqual(4_200_000 + 20_000)
  })
})

describe('buildEditGraph', () => {
  test('references the uploaded source and injects a LoRA node', () => {
    const graph = buildEditGraph({
      prompt: 'change jacket to red leather',
      sourceName: 'genui_real_1.png',
      seed: 5,
      steps: 4,
      lora: 'style.safetensors',
      loraStrength: 0.7,
    })
    expect(graph['4'].inputs.image).toBe('genui_real_1.png')
    expect(graph['9'].inputs.text).toBe('change jacket to red leather')
    expect(graph['20'].inputs.lora_name).toBe('style.safetensors')
    expect(graph['20'].inputs.strength_model).toBe(0.7)
    expect(graph['13'].inputs.model).toEqual(['20', 0])
  })

  test('an unset LoRA leaves the committed graph byte-identical', () => {
    const graph = buildEditGraph({
      prompt: 'make it night',
      sourceName: 'genui_real_1.png',
      seed: 5,
      steps: 4,
    })
    expect(graph['20']).toBeUndefined()
    expect(graph['13'].inputs.model).toEqual(['1', 0])
    expect(graph['19'].inputs.filename_prefix).toBe(`${dateFolder()}/genui_edit_5`)
  })
})

describe('the file prefix', () => {
  test('the folder is the local date, zero-padded', () => {
    expect(dateFolder(new Date(2026, 10, 5, 23, 30))).toBe('ds-2026-11-05')
    expect(dateFolder(new Date(2026, 0, 9, 1, 5))).toBe('ds-2026-01-09')
  })

  test('defaults to genui and is configurable per deployment', () => {
    expect(buildGraph(real.fast, { prompt: 'x', count: 1 }, 7)['9'].inputs.filename_prefix).toBe(
      `${dateFolder()}/genui_real_7`,
    )
    expect(
      buildGraph(real.fast, { prompt: 'x', count: 1 }, 7, MAX_BATCH, 'studio')['9'].inputs
        .filename_prefix,
    ).toBe(`${dateFolder()}/studio_real_7`)
  })

  test('reaches the edit graph', () => {
    const graph = buildEditGraph({ prompt: 'x', sourceName: 'a.png', seed: 3, steps: 4 }, 'studio')
    expect(graph['19'].inputs.filename_prefix).toBe(`${dateFolder()}/studio_edit_3`)
  })

  test('reaches the defaults helper', () => {
    expect(defaultsFor(anime.fast, 'studio').prefix).toBe('studio_anime')
  })
})
