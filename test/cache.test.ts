import { describe, expect, test } from 'bun:test'
import { cachedRender, hydratedOnce, imageKey, imageCache, lookupRender, migrateKey, type Rendered } from '../src/client/imageCache'

function render(overrides: Partial<Rendered> = {}): Rendered {
  return {
    url: '/genui/images/harness_real_1.png',
    file: 'harness_real_1.png',
    prompt: 'a red fox',
    lane: 'real',
    quality: 'fast',
    seed: 1,
    steps: 4,
    images: [],
    ...overrides,
  }
}

describe('imageKey', () => {
  test('is stable across cosmetic whitespace', () => {
    expect(imageKey({ prompt: ' a  red   fox ' })).toBe(imageKey({ prompt: 'a red fox' }))
  })

  test('defaults match what the host would run', () => {
    expect(imageKey({ prompt: 'x' })).toBe(
      JSON.stringify(['real', 'x', 'fast', 1, 832, 1216, null, null, null, null]),
    )
  })

  test('every field that changes the picture changes the key', () => {
    const base = { prompt: 'x', lane: 'real', quality: 'fast', count: 1, negative: undefined, source: undefined }
    const keys = new Set([
      imageKey(base),
      imageKey({ ...base, lane: 'anime' }),
      imageKey({ ...base, prompt: 'y' }),
      imageKey({ ...base, quality: 'high' }),
      imageKey({ ...base, count: 2 }),
      imageKey({ ...base, width: 992 }),
      imageKey({ ...base, height: 1504 }),
      imageKey({ ...base, steps: 8 }),
      imageKey({ ...base, cfg: 3 }),
      imageKey({ ...base, negative: 'blurry' }),
      imageKey({ ...base, source: 'harness_real_2.png' }),
    ])
    expect(keys.size).toBe(11)
  })
})

describe('migrateKey', () => {
  test('rewrites the old seven-field shape', () => {
    const old = JSON.stringify(['real', 'a red fox', 832, 1216, 4, 1, null])
    expect(migrateKey(old)).toBe(
      imageKey({ lane: 'real', prompt: 'a red fox', quality: 'fast', count: 1, width: 832, height: 1216, steps: 4, cfg: 1, negative: null }),
    )
  })

  test('leaves a current key and junk alone', () => {
    const current = imageKey({ prompt: 'x' })
    expect(migrateKey(current)).toBe(null)
    expect(migrateKey('not json')).toBe(null)
    expect(migrateKey(JSON.stringify([1, 2]))).toBe(null)
  })
})

describe('lookupRender', () => {
  test('finds nothing before a render is produced', async () => {
    await hydratedOnce()
    expect(await lookupRender(imageKey({ prompt: 'never rendered' }))).toBeUndefined()
  })

  test('returns a produced render without producing one itself', async () => {
    const args = { prompt: 'lookup-only render' }
    const key = imageKey(args)
    let produced = 0
    await cachedRender(key, async () => {
      produced++
      return render({ prompt: args.prompt })
    })
    const hit = await lookupRender(key)
    expect(hit?.prompt).toBe(args.prompt)
    expect(produced).toBe(1)
    expect(await lookupRender(key)).toBe(hit as Rendered)
  })
})

describe('cachedRender', () => {
  test('produces once and answers the same result afterwards', async () => {
    const key = imageKey({ prompt: 'cached once' })
    let produced = 0
    const produce = async () => {
      produced++
      return render({ prompt: 'cached once', seed: produced })
    }
    const first = await cachedRender(key, produce)
    const second = await cachedRender(key, produce)
    expect(produced).toBe(1)
    expect(second).toBe(first)
    expect(imageCache.get(key)).toBe(first)
  })

  test('shares one in-flight job between concurrent callers', async () => {
    const key = imageKey({ prompt: 'shared flight' })
    let produced = 0
    const produce = async () => {
      produced++
      await new Promise((resolve) => setTimeout(resolve, 10))
      return render({ prompt: 'shared flight' })
    }
    const [a, b] = await Promise.all([cachedRender(key, produce), cachedRender(key, produce)])
    expect(produced).toBe(1)
    expect(a).toBe(b)
  })

  test('does not store a failed render', async () => {
    const key = imageKey({ prompt: 'fails once' })
    await expect(cachedRender(key, async () => Promise.reject(new Error('fetch failed')))).rejects.toThrow('fetch failed')
    expect(imageCache.get(key)).toBeUndefined()
  })
})
