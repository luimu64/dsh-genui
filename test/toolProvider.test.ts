/**
 * The query provider: the one place a rendered answer is allowed to spend GPU time.
 *
 * These tests pin the two behaviours the replay gate depends on — a historical turn must get a
 * `missing` result instead of a POST, and a live one must POST once and then answer from cache —
 * plus the request shape the host routes expect.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { imageKey } from '../src/client/imageCache'
import { makeToolProvider } from '../src/client/toolProvider'

const realFetch = globalThis.fetch
let calls: { url: string; body: any }[] = []
let reply: { status: number; body: unknown } = { status: 200, body: {} }

function stubFetch() {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input)
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  calls = []
  stubFetch()
  // The provider resolves its routes against the page URL; Bun has no document.
  ;(globalThis as any).document = { baseURI: 'http://127.0.0.1:3080/' }
})
afterEach(() => {
  globalThis.fetch = realFetch
})

const rendered = (prompt: string) => ({
  url: `/genui/images/${encodeURIComponent(prompt)}.png`,
  file: `${prompt}.png`,
  prompt,
  lane: 'real',
  quality: 'fast',
  seed: 1,
  steps: 4,
  images: [],
})

describe('makeToolProvider', () => {
  test('a live turn posts once, then answers from the cache', async () => {
    const prompt = 'live render once'
    reply = { status: 200, body: rendered(prompt) }
    const provider = makeToolProvider({ allowGeneration: true })

    const first = await provider.generate_image({ prompt, lane: 'real' })
    expect(first.url).toBe(`/genui/images/${encodeURIComponent(prompt)}.png`)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/genui/generate')
    expect(calls[0].body).toEqual({ req: { prompt, lane: 'real' } })

    const second = await provider.generate_image({ prompt, lane: 'real' })
    expect(second).toEqual(first)
    expect(calls).toHaveLength(1)
  })

  test('a historical turn never posts: a cache miss is a hole, not a render', async () => {
    const provider = makeToolProvider({ allowGeneration: false })
    const result = await provider.generate_image({ prompt: 'never rendered before' })
    expect(calls).toHaveLength(0)
    expect(result.missing).toBe(true)
    expect(result.url).toBe('')
    expect(result.images).toEqual([])
  })

  test('a historical turn still displays what the cache holds', async () => {
    const prompt = 'cached before replay'
    reply = { status: 200, body: rendered(prompt) }
    await makeToolProvider({ allowGeneration: true }).generate_image({ prompt })
    expect(calls).toHaveLength(1)

    const replay = await makeToolProvider({ allowGeneration: false }).generate_image({ prompt })
    expect(replay.url).toBe(`/genui/images/${encodeURIComponent(prompt)}.png`)
    expect(calls).toHaveLength(1)
  })

  test('the newest turn renders even when it was never seen streaming', async () => {
    // A provider that publishes an assistant step already settled never paints `running`,
    // so `allowGeneration` stays false for a turn the user just asked for. Being the tail is
    // the signal that it is theirs to render.
    const prompt = 'fresh turn, settled row'
    reply = { status: 200, body: rendered(prompt) }
    const provider = makeToolProvider({ allowGeneration: false, isTail: () => true })
    const result = await provider.generate_image({ prompt })
    expect(result.missing).toBeUndefined()
    expect(calls).toHaveLength(1)
  })

  test('an earlier turn is still inert while the tail renders', async () => {
    const provider = makeToolProvider({ allowGeneration: false, isTail: () => false })
    const result = await provider.generate_image({ prompt: 'scrolled-back turn' })
    expect(result.missing).toBe(true)
    expect(calls).toHaveLength(0)
  })

  test('count above 1 hands back one slot per frame instead of waiting for a set', async () => {
    const prompt = 'batch slots'
    reply = { status: 200, body: rendered(prompt) }
    const provider = makeToolProvider({ allowGeneration: true })
    const result = await provider.generate_image({ prompt, lane: 'real', count: 3 })

    // The query resolves at once: the frames arrive through the batch store, one at a time.
    expect(result.url).toBe('')
    expect(result.images).toHaveLength(3)
    expect(result.images?.every((image) => typeof image.batch === 'string')).toBe(true)
    expect(result.images?.map((image) => image.index)).toEqual([0, 1, 2])
    expect(result.images?.every((image) => image.total === 3)).toBe(true)
  })

  test('a prompt list sizes the batch and is passed through per frame', async () => {
    reply = { status: 200, body: rendered('listed') }
    const provider = makeToolProvider({ allowGeneration: true })
    const prompts = ['a fox in snow', 'a fox on sand', 'a fox in rain']
    const result = await provider.generate_image({ prompt: prompts[0], prompts, lane: 'real' })
    expect(result.images).toHaveLength(3)
    expect(result.images?.map((image) => image.index)).toEqual([0, 1, 2])
  })

  test('a prompt list alone is a valid batch, no shared prompt needed', async () => {
    // This is how the model actually wrote it: prompts only. Demanding a single prompt
    // failed the query, and every tile painted "could not render this picture".
    reply = { status: 200, body: rendered('listed only') }
    const provider = makeToolProvider({ allowGeneration: true })
    const prompts = ['a fox in snow', 'a fox on sand']
    const result = await provider.generate_image({ prompts, lane: 'real' })
    expect(result.images).toHaveLength(2)
    expect(result.prompt).toBe('a fox in snow')
  })

  test('no prompt and no prompt list still fails before any request', async () => {
    const provider = makeToolProvider({ allowGeneration: true })
    await expect(provider.generate_image({ lane: 'real' })).rejects.toThrow('needs a prompt')
    expect(calls).toHaveLength(0)
  })

  test('a stored batch is a hole per frame, never a new queue', async () => {
    const provider = makeToolProvider({ allowGeneration: false })
    const result = await provider.generate_image({ prompt: 'stored batch', count: 2 })
    expect(calls).toHaveLength(0)
    expect(result.images).toHaveLength(2)
    expect(result.images?.every((image) => !image.url)).toBe(true)
  })

  test('edit_image goes to the edit route with its source', async () => {
    reply = { status: 200, body: { ...rendered('edited'), lane: 'edit' } }
    const provider = makeToolProvider({ allowGeneration: true })
    await provider.edit_image({ prompt: 'make it night', source: 'genui_real_1.png' })
    expect(calls[0].url).toContain('/genui/edit')
    expect(calls[0].body).toEqual({ req: { prompt: 'make it night', source: 'genui_real_1.png' } })
  })

  test('a missing prompt fails before any request', async () => {
    const provider = makeToolProvider({ allowGeneration: true })
    await expect(provider.generate_image({})).rejects.toThrow('needs a prompt')
    expect(calls).toHaveLength(0)
  })

  test("the host's error text reaches the renderer", async () => {
    reply = { status: 500, body: { error: 'comfyui is not running' } }
    const provider = makeToolProvider({ allowGeneration: true })
    await expect(provider.generate_image({ prompt: 'error path render' })).rejects.toThrow(
      'comfyui is not running',
    )
  })

  test('a failed render is not cached, so a retry can still work', async () => {
    const prompt = 'fails then retried'
    // A permanent rejection: no retry loop, just the error and an untouched cache.
    reply = { status: 400, body: { error: 'comfy rejected the graph (400)' } }
    await expect(makeToolProvider({ allowGeneration: true }).generate_image({ prompt })).rejects.toThrow()

    reply = { status: 200, body: rendered(prompt) }
    const ok = await makeToolProvider({ allowGeneration: true }).generate_image({ prompt })
    expect(ok.url).toContain(encodeURIComponent(prompt))
  })

  test('keys the render by the request, not the object identity', () => {
    expect(imageKey({ prompt: 'a', lane: 'real' })).toBe(imageKey({ prompt: ' a ', lane: 'real' }))
  })
})
