import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGenuiService } from '../src/host/service'
import { readRender, saveRender } from '../src/host/images'
import { startFakeComfy } from './fixtures/comfy'

let fake: Awaited<ReturnType<typeof startFakeComfy>>
let dir: string
let service: ReturnType<typeof createGenuiService>

beforeAll(async () => {
  fake = await startFakeComfy({ imageBytes: new Uint8Array([137, 80, 78, 71]) })
  dir = await mkdtemp(join(tmpdir(), 'genui-'))
  service = createGenuiService({
    comfyBase: fake.base,
    imagesDir: dir,
    pollMs: 10,
    maxBatch: 8,
    minPngBytes: 4,
  })
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
    expect(result.file).toBe('harness_real_1.png')
    expect(result.url).toBe('/genui/images/harness_real_1.png')
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

  test('a junk frame fails the request instead of saving it', async () => {
    const tiny = await startFakeComfy({ imageBytes: new Uint8Array([1, 2]) })
    const strict = createGenuiService({
      comfyBase: tiny.base,
      imagesDir: dir,
      pollMs: 10,
      maxBatch: 8,
      minPngBytes: 30_000,
    })
    await expect(strict.generate({ lane: 'real', prompt: 'x' })).rejects.toThrow('failed render')
    tiny.stop()
  })
})

describe('edit', () => {
  test('edits the newest render when no source is given', async () => {
    const newer = await startFakeComfy({
      imageBytes: new Uint8Array([137, 80, 78, 71, 1, 2]),
      filename: 'harness_edit_9.png',
    })
    const editService = createGenuiService({
      comfyBase: newer.base,
      imagesDir: dir,
      pollMs: 10,
      maxBatch: 8,
      minPngBytes: 4,
    })
    await saveRender(dir, 'newest.png', new Uint8Array([137, 80, 78, 71]))
    await new Promise((r) => setTimeout(r, 20))
    const result = await editService.edit({ prompt: 'make it night' })
    expect(newer.uploads()).toEqual(['newest.png'])
    expect(result.file).toBe('harness_edit_9.png')
    expect(result.lane).toBe('edit')
    expect(result.url).toBe('/genui/images/harness_edit_9.png')
    const graph = newer.queued().at(-1) as any
    expect(graph.prompt['4'].inputs.image).toBe('source.png')
    expect(graph.prompt['9'].inputs.text).toBe('make it night')
    newer.stop()
  })

  test('an explicit source is used and an unknown one is refused', async () => {
    const editService = createGenuiService({
      comfyBase: fake.base,
      imagesDir: dir,
      pollMs: 10,
      maxBatch: 8,
      minPngBytes: 4,
    })
    await saveRender(dir, 'older.png', new Uint8Array([137, 80, 78, 71]))
    await editService.edit({ prompt: 'make it night', source: 'older.png' })
    await expect(editService.edit({ prompt: 'x', source: '../etc/passwd' })).rejects.toThrow()
    await expect(editService.edit({ prompt: 'x', source: 'gone.png' })).rejects.toThrow('no such image')
  })
})

describe('health', () => {
  test('reports comfy as down when the port is dead', async () => {
    const dead = createGenuiService({
      comfyBase: 'http://127.0.0.1:1',
      imagesDir: dir,
      pollMs: 10,
      maxBatch: 8,
      minPngBytes: 4,
    })
    expect(await dead.health()).toEqual({ comfy: false })
  })

  test('reports comfy as up when system_stats answers', async () => {
    const up = Bun.serve({ port: 0, fetch: () => Response.json({ system: { comfyui_version: '0.0' } }) })
    const live = createGenuiService({
      comfyBase: `http://127.0.0.1:${up.port}`,
      imagesDir: dir,
      pollMs: 10,
      maxBatch: 8,
      minPngBytes: 4,
    })
    expect(await live.health()).toEqual({ comfy: true })
    up.stop(true)
  })
})
