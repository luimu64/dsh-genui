import { describe, expect, test } from 'bun:test'
import {
  MAX_BATCH,
  buildEditGraph,
  buildGraph,
  effectiveUpscale,
  isLane,
  isPreset,
  isQuality,
  presetDefaults,
  qualityDefaults,
  renderDefaults,
} from '../src/host/graphs'
import { PRESET_MODELS } from '../src/host/models'
import { LANE_IDS, PRESET_IDS, QUALITY_IDS } from '../src/shared/models'

describe('buildGraph', () => {
  test('real fast uses 4 steps, cfg 1, 832x1216, seed in the prefix', () => {
    const graph = buildGraph({ lane: 'real', quality: 'fast', prompt: 'a red fox in snow', count: 1 }, 42)
    expect(graph['5'].inputs.width).toBe(832)
    expect(graph['5'].inputs.height).toBe(1216)
    expect(graph['6'].inputs.steps).toBe(4)
    expect(graph['6'].inputs.cfg).toBe(1)
    expect(graph['6'].inputs.seed).toBe(42)
    expect(graph['9'].inputs.filename_prefix).toBe('genui_real_42')
  })

  test('anime fast prepends the template style block', () => {
    const graph = buildGraph({ lane: 'anime', quality: 'fast', prompt: '1girl, red hair', count: 1 }, 7)
    expect(graph['3'].inputs.text).toContain('masterpiece')
    expect(graph['3'].inputs.text).toContain('1girl, red hair')
  })

  test('nsfw drops score negatives', () => {
    const graph = buildGraph({ lane: 'anime', quality: 'fast', prompt: '1girl, nude', nsfw: true, count: 1 }, 7)
    expect(graph['4'].inputs.text).not.toContain('score_1')
  })

  test('count clamps to 8', () => {
    const graph = buildGraph({ lane: 'real', quality: 'fast', prompt: 'x', count: 99 }, 1)
    expect(graph['5'].inputs.batch_size).toBe(8)
  })

  test('an untouched build does not mutate the committed template', () => {
    const first = buildGraph({ lane: 'real', quality: 'fast', prompt: 'first', count: 1 }, 1)
    const second = buildGraph({ lane: 'real', quality: 'fast', prompt: 'second', count: 1 }, 2)
    expect(second['3'].inputs.text).toBe('second')
    expect(first['6'].inputs.seed).toBe(1)
  })
})

describe('presets', () => {
  test('miaoharem swaps the checkpoint and runs its own settings', () => {
    const graph = buildGraph({ lane: 'anime', preset: 'miaoharem', prompt: '1girl, red hair', count: 1 }, 5)
    expect(graph['1'].inputs.unet_name).toBe('MiaoMiaoHarem_Anima_1.6.safetensors')
    expect(graph['6'].inputs.steps).toBe(30)
    expect(graph['6'].inputs.cfg).toBe(4.5)
    expect(graph['6'].inputs.sampler_name).toBe('euler')
    expect(graph['9'].inputs.filename_prefix).toBe('genui_anima_miao_5')
  })

  test('dasiwa swaps the checkpoint and keeps the anime stack', () => {
    const graph = buildGraph({ lane: 'anime', preset: 'dasiwa', prompt: '1girl, knight', count: 1 }, 6)
    expect(graph['1'].inputs.unet_name).toBe('dasiwaAnima_obsidianArchivesV2.safetensors')
    expect(graph['2'].inputs.clip_name).toBe('qwen_3_06b_base.safetensors')
    expect(graph['8'].inputs.vae_name).toBe('qwen_image_vae.safetensors')
    expect(graph['9'].inputs.filename_prefix).toBe('genui_anima_dasiwa_6')
  })

  test('a preset carries the danbooru prefix and appends the prompt', () => {
    const graph = buildGraph({ lane: 'anime', preset: 'miaoharem', prompt: '1girl, solo', count: 1 }, 1)
    expect(graph['3'].inputs.text).toContain('very aesthetic')
    expect(graph['3'].inputs.text).toContain('1girl, solo')
  })

  test('quality does not reach a preset graph', () => {
    const fast = buildGraph({ lane: 'anime', preset: 'dasiwa', quality: 'fast', prompt: 'x', count: 1 }, 1)
    const high = buildGraph({ lane: 'anime', preset: 'dasiwa', quality: 'high', prompt: 'x', count: 1 }, 1)
    expect(high['6'].inputs.steps).toBe(fast['6'].inputs.steps)
    expect(high['6'].inputs.cfg).toBe(fast['6'].inputs.cfg)
  })

  test('a preset on the real lane is a mistake, not a silent fallback', () => {
    expect(() => buildGraph({ lane: 'real', preset: 'dasiwa', prompt: 'x' }, 1)).toThrow('lane "anime"')
  })

  test('an unknown preset falls back to the default pair', () => {
    const graph = buildGraph({ lane: 'anime', preset: 'nope' as any, prompt: 'x', count: 1 }, 1)
    expect(graph['1'].inputs.unet_name).toBe('anima-turbo-v1.1.safetensors')
  })

  test('presetDefaults pins the published settings', () => {
    expect(presetDefaults('dasiwa')).toEqual({
      width: 832,
      height: 1216,
      steps: 30,
      cfg: 4.5,
      prefix: 'genui_anima_dasiwa',
    })
  })
})

describe('hires pass', () => {
  test('adds an upscale and a refine sampler, and decodes the refined latent', () => {
    const graph = buildGraph(
      { lane: 'anime', quality: 'high', preset: 'miaoharem', prompt: 'x', upscale: 1.5, count: 1 },
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
    const graph = buildGraph({ lane: 'real', quality: 'fast', prompt: 'x', upscale: true, count: 1 }, 9)
    expect(graph['21'].inputs.scale_by).toBe(1.5)
    expect(Number(graph['22'].inputs.steps)).toBe(Math.max(8, Math.round(4 * 0.6)))
  })

  test('no upscale leaves the graph without the extra nodes', () => {
    const graph = buildGraph({ lane: 'real', quality: 'fast', prompt: 'x', count: 1 }, 9)
    expect(graph['21']).toBeUndefined()
    expect(graph['22']).toBeUndefined()
    expect(graph['7'].inputs.samples).toEqual(['6', 0])
  })

  test('the refine pass keeps a template LoRA in the chain', () => {
    const graph = buildGraph({ lane: 'real', quality: 'fast', prompt: 'x', upscale: 1.5, count: 1 }, 9)
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
    expect(graph['19'].inputs.filename_prefix).toBe('genui_edit_5')
  })
})

describe('qualityDefaults', () => {
  test('real high is 992x1504, 50 steps, cfg 3', () => {
    expect(qualityDefaults('real', 'high')).toEqual({
      width: 992,
      height: 1504,
      steps: 50,
      cfg: 3,
      prefix: 'genui_real_hq',
    })
  })

  test('anime high is 832x1216, 30 steps, cfg 5', () => {
    expect(qualityDefaults('anime', 'high')).toEqual({
      width: 832,
      height: 1216,
      steps: 30,
      cfg: 5,
      prefix: 'genui_anime_hq',
    })
  })
})

describe('the model roster', () => {
  test('every advertised lane and quality resolves to a graph', () => {
    for (const lane of LANE_IDS) {
      for (const quality of QUALITY_IDS) {
        const graph = buildGraph({ lane, quality, prompt: 'x', count: 1 }, 1)
        expect(Object.keys(graph).length).toBeGreaterThan(5)
        expect(graph['6'].class_type).toBe('KSampler')
      }
    }
  })

  test('every advertised preset resolves to its own anime graph', () => {
    for (const preset of PRESET_IDS) {
      const graph = buildGraph({ lane: 'anime', preset, prompt: 'x', count: 1 }, 1)
      expect(graph['6'].inputs.steps).toBe(PRESET_MODELS[preset].steps)
      expect(graph['1'].inputs.unet_name).toBe(
        (PRESET_MODELS[preset].graph['1'] as any).inputs.unet_name,
      )
    }
  })

  test('the host accepts exactly the ids the client advertises', () => {
    for (const lane of LANE_IDS) expect(isLane(lane)).toBe(true)
    for (const quality of QUALITY_IDS) expect(isQuality(quality)).toBe(true)
    for (const preset of PRESET_IDS) expect(isPreset(preset)).toBe(true)
    expect(isLane('video')).toBe(false)
    expect(isQuality('best')).toBe(false)
    expect(isPreset('nope')).toBe(false)
  })
})

describe('the file prefix', () => {
  test('defaults to genui and is configurable per deployment', () => {
    expect(buildGraph({ lane: 'real', prompt: 'x', count: 1 }, 7)['9'].inputs.filename_prefix).toBe(
      'genui_real_7',
    )
    expect(
      buildGraph({ lane: 'real', prompt: 'x', count: 1 }, 7, MAX_BATCH, 'studio')['9'].inputs
        .filename_prefix,
    ).toBe('studio_real_7')
  })

  test('reaches the edit graph and its defaults', () => {
    const graph = buildEditGraph(
      { prompt: 'x', sourceName: 'a.png', seed: 3, steps: 4 },
      'studio',
    )
    expect(graph['19'].inputs.filename_prefix).toBe('studio_edit_3')
  })

  test('reaches the defaults helpers', () => {
    expect(qualityDefaults('anime', 'fast', 'studio').prefix).toBe('studio_anime')
    expect(presetDefaults('dasiwa', 'studio').prefix).toBe('studio_anima_dasiwa')
    expect(renderDefaults('real', 'high', undefined, 'studio').prefix).toBe('studio_real_hq')
  })
})
