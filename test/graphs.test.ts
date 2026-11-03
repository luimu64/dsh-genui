import { describe, expect, test } from 'bun:test'
import { buildEditGraph, buildGraph, qualityDefaults } from '../src/host/graphs'

describe('buildGraph', () => {
  test('real fast uses 4 steps, cfg 1, 832x1216, seed in the prefix', () => {
    const graph = buildGraph({ lane: 'real', quality: 'fast', prompt: 'a red fox in snow', count: 1 }, 42)
    expect(graph['5'].inputs.width).toBe(832)
    expect(graph['5'].inputs.height).toBe(1216)
    expect(graph['6'].inputs.steps).toBe(4)
    expect(graph['6'].inputs.cfg).toBe(1)
    expect(graph['6'].inputs.seed).toBe(42)
    expect(graph['9'].inputs.filename_prefix).toBe('harness_real_42')
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

describe('buildEditGraph', () => {
  test('references the uploaded source and injects a LoRA node', () => {
    const graph = buildEditGraph({
      prompt: 'change jacket to red leather',
      sourceName: 'harness_real_1.png',
      seed: 5,
      steps: 4,
      lora: 'style.safetensors',
      loraStrength: 0.7,
    })
    expect(graph['4'].inputs.image).toBe('harness_real_1.png')
    expect(graph['9'].inputs.text).toBe('change jacket to red leather')
    expect(graph['20'].inputs.lora_name).toBe('style.safetensors')
    expect(graph['20'].inputs.strength_model).toBe(0.7)
    expect(graph['13'].inputs.model).toEqual(['20', 0])
  })

  test('an unset LoRA leaves the committed graph byte-identical', () => {
    const graph = buildEditGraph({
      prompt: 'make it night',
      sourceName: 'harness_real_1.png',
      seed: 5,
      steps: 4,
    })
    expect(graph['20']).toBeUndefined()
    expect(graph['13'].inputs.model).toEqual(['1', 0])
    expect(graph['19'].inputs.filename_prefix).toBe('harness_edit_5')
  })
})

describe('qualityDefaults', () => {
  test('real high is 992x1504, 50 steps, cfg 3', () => {
    expect(qualityDefaults('real', 'high')).toEqual({
      width: 992,
      height: 1504,
      steps: 50,
      cfg: 3,
      prefix: 'harness_real_hq',
    })
  })

  test('anime high is 832x1216, 30 steps, cfg 5', () => {
    expect(qualityDefaults('anime', 'high')).toEqual({
      width: 832,
      height: 1216,
      steps: 30,
      cfg: 5,
      prefix: 'harness_anime_hq',
    })
  })
})
