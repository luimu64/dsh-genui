import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGenuiService } from '../src/host/service'
import { readRender, saveRender } from '../src/host/images'
import { startFakeComfy } from './fixtures/comfy'
import { testConfig } from './helpers'

let fake: Awaited<ReturnType<typeof startFakeComfy>>
let dir: string
let service: ReturnType<typeof createGenuiService>

beforeAll(async () => {
  fake = await startFakeComfy({ imageBytes: new Uint8Array([137, 80, 78, 71]) })
  dir = await mkdtemp(join(tmpdir(), 'genui-'))
  service = createGenuiService(testConfig({ comfyBase: fake.base, imagesDir: dir, pollMs: 10, minPngBytes: 4 }))
})
afterAll(async () => {
  fake.stop()
  await rm(dir, { recursive: true, force: true })
})

describe('generate', () => {
  test('generate saves one image and returns a browser URL', async () => {
    const result = await service.generate({
      lane: 'real',
      quality: 'fast',
      prompt: 'a red fox',
      count: 1,
    })
    expect(result.file).toBe('genui_real_1.png')
    expect(result.url).toBe('/genui/images/genui_real_1.png')
    expect(result.images).toHaveLength(1)
    expect(await readRender(dir, result.file)).toEqual(new Uint8Array([137, 80, 78, 71]))
  })

  test('a batch is one queue item', async () => {
    const before = fake.queueCount()
    await service.generate({ lane: 'anime', prompt: 'x', count: 4 })
    expect(fake.queueCount()).toBe(before + 1)
    const graph = fake.queued().at(-1) as any
    expect(graph.prompt['5'].inputs.batch_size).toBe(4)
  })

  test('a count above maxBatch clamps', async () => {
    await service.generate({ lane: 'real', prompt: 'x', count: 99 })
    const graph = fake.queued().at(-1) as any
    expect(graph.prompt['5'].inputs.batch_size).toBe(8)
  })

  test('a typo in the lane falls back to real instead of failing the render', async () => {
    const result = await service.generate({ lane: 'video', prompt: 'x' })
    expect(result.lane).toBe('real')
    const graph = fake.queued().at(-1) as any
    expect(graph.prompt['5'].inputs.batch_size).toBe(1)
  })

  test('rejects a missing prompt and the edit lane', async () => {
    await expect(service.generate({ prompt: '  ' })).rejects.toThrow('needs a prompt')
    await expect(service.generate({ lane: 'edit', prompt: 'x' })).rejects.toThrow('edit_image')
  })

  test('a preset reaches the queue and comes back in the metadata', async () => {
    const result = await service.generate({ lane: 'anime', preset: 'dasiwa', prompt: 'x' })
    expect(result.preset).toBe('dasiwa')
    expect(result.images[0].preset).toBe('dasiwa')
    const graph = fake.queued().at(-1) as any
    expect(graph.prompt['1'].inputs.unet_name).toBe('dasiwaAnima_obsidianArchivesV2.safetensors')
    expect(graph.prompt['6'].inputs.steps).toBe(30)
  })

  test('a preset on the real lane is refused before anything is queued', async () => {
    const before = fake.queueCount()
    await expect(service.generate({ lane: 'real', preset: 'miaoharem', prompt: 'x' })).rejects.toThrow(
      'lane "anime"',
    )
    expect(fake.queueCount()).toBe(before)
  })

  test('upscale queues the hires pair and reports the factor', async () => {
    const result = await service.generate({ lane: 'real', prompt: 'x', upscale: true })
    expect(result.upscale).toBe(1.5)
    const graph = fake.queued().at(-1) as any
    expect(graph.prompt['21'].inputs.scale_by).toBe(1.5)
    expect(graph.prompt['7'].inputs.samples).toEqual(['22', 0])
  })

  test('no upscale means the metadata carries no factor', async () => {
    const result = await service.generate({ lane: 'real', prompt: 'x' })
    expect(result.upscale).toBeUndefined()
    expect(result.images[0].upscale).toBeUndefined()
  })

  test('a junk frame fails the request instead of saving it', async () => {
    const tiny = await startFakeComfy({ imageBytes: new Uint8Array([1, 2]) })
    const strict = createGenuiService(testConfig({ comfyBase: tiny.base, imagesDir: dir, pollMs: 10, minPngBytes: 30_000 }))
    await expect(strict.generate({ lane: 'real', prompt: 'x' })).rejects.toThrow('failed render')
    tiny.stop()
  })
})

describe('edit', () => {
  test('edits the newest render when no source is given', async () => {
    const newer = await startFakeComfy({
      imageBytes: new Uint8Array([137, 80, 78, 71, 1, 2]),
      filename: 'genui_edit_9.png',
    })
    const editService = createGenuiService(testConfig({ comfyBase: newer.base, imagesDir: dir, pollMs: 10, minPngBytes: 4 }))
    await saveRender(dir, 'newest.png', new Uint8Array([137, 80, 78, 71]))
    await new Promise((r) => setTimeout(r, 20))
    const result = await editService.edit({ prompt: 'make it night' })
    expect(newer.uploads()).toEqual(['newest.png'])
    expect(result.file).toBe('genui_edit_9.png')
    expect(result.lane).toBe('edit')
    expect(result.url).toBe('/genui/images/genui_edit_9.png')
    const graph = newer.queued().at(-1) as any
    expect(graph.prompt['4'].inputs.image).toBe('source.png')
    expect(graph.prompt['9'].inputs.text).toBe('make it night')
    newer.stop()
  })

  test('an explicit source is used and an unknown one is refused', async () => {
    const editService = createGenuiService(testConfig({ comfyBase: fake.base, imagesDir: dir, pollMs: 10, minPngBytes: 4 }))
    await saveRender(dir, 'older.png', new Uint8Array([137, 80, 78, 71]))
    await editService.edit({ prompt: 'make it night', source: 'older.png' })
    await expect(editService.edit({ prompt: 'x', source: '../etc/passwd' })).rejects.toThrow()
    await expect(editService.edit({ prompt: 'x', source: 'gone.png' })).rejects.toThrow('no such image')
  })
})

describe('health', () => {
  test('reports comfy as down when the port is dead', async () => {
    const dead = createGenuiService(testConfig({ comfyBase: 'http://127.0.0.1:1', imagesDir: dir, pollMs: 10, minPngBytes: 4 }))
    expect(await dead.health()).toEqual({ comfy: false, workflows: ['real', 'anime'] })
  })

  test('reports comfy as up when system_stats answers', async () => {
    const up = Bun.serve({ port: 0, fetch: () => Response.json({ system: { comfyui_version: '0.0' } }) })
    const live = createGenuiService(testConfig({ comfyBase: `http://127.0.0.1:${up.port}`, imagesDir: dir, pollMs: 10, minPngBytes: 4 }))
    expect(await live.health()).toEqual({ comfy: true, workflows: ['real', 'anime'] })
    up.stop(true)
  })
})

describe('opt-in workflows', () => {
  test('a lane the deployment did not enable is refused before anything is queued', async () => {
    const before = fake.queueCount()
    const realOnly = createGenuiService(
      testConfig({ comfyBase: fake.base, imagesDir: dir, pollMs: 10, minPngBytes: 4, workflows: ['real'] }),
    )
    await expect(realOnly.generate({ lane: 'anime', prompt: 'x' })).rejects.toThrow(
      'lane "anime" is not enabled',
    )
    // A preset rides the anime lane, so it is refused by the same gate.
    await expect(realOnly.generate({ lane: 'anime', prompt: 'x', preset: 'dasiwa' })).rejects.toThrow(
      'is not enabled',
    )
    expect(fake.queueCount()).toBe(before)
  })

  test('the default lane still renders when only real is enabled', async () => {
    const realOnly = createGenuiService(
      testConfig({ comfyBase: fake.base, imagesDir: dir, pollMs: 10, minPngBytes: 4, workflows: ['real'] }),
    )
    const result = await realOnly.generate({ prompt: 'a red fox' })
    expect(result.lane).toBe('real')
  })

  test('health reports the enabled workflows', async () => {
    const realOnly = createGenuiService(
      testConfig({ comfyBase: 'http://127.0.0.1:1', pollMs: 10, minPngBytes: 4, workflows: ['real'] }),
    )
    expect(await realOnly.health()).toEqual({ comfy: false, workflows: ['real'] })
  })
})

describe('live workflow changes', () => {
  test('a write to the volatile field lands on the next request', async () => {
    let current: string[] = ['real']
    const workflows = { get: () => current }
    const service = createGenuiService(
      testConfig({ comfyBase: fake.base, imagesDir: dir, pollMs: 10, minPngBytes: 4, workflows }),
    )
    await expect(service.generate({ lane: 'anime', prompt: 'x' })).rejects.toThrow('is not enabled')

    // What the Settings row does: the reference is updated in place, no restart.
    current = ['real', 'anime']
    const result = await service.generate({ lane: 'anime', prompt: 'x' })
    expect(result.lane).toBe('anime')
    expect((await service.health()).workflows).toEqual(['real', 'anime'])
  })
})
