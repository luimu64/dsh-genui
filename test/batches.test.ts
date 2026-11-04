/**
 * Progressive batches: the queue that makes a four-image request paint four frames as they
 * land instead of one grid after the whole set.
 *
 * These tests pin the properties the UI depends on — one job at a time, a slot published the
 * moment its frame exists, a stored turn that never queues, and a failure that stays inside
 * its own slot.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  batchKey,
  batchSlots,
  batchVersion,
  slotKey,
  startBatch,
  subscribeBatch,
} from '../src/client/batches'

const realFetch = globalThis.fetch
let calls: { body: any }[] = []
/** Set to make the Nth request (1-based) answer with an error. */
let failOn = new Set<number>()

function stubFetch() {
  globalThis.fetch = (async (input: any, init?: any) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ body })
    const n = calls.length
    if (failOn.has(n)) {
      return new Response(JSON.stringify({ error: 'comfy said no' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }
    const prompt = String(body?.req?.prompt ?? '')
    return new Response(
      JSON.stringify({
        url: `/genui/images/${encodeURIComponent(prompt)}-${n}.png`,
        file: `${prompt}-${n}.png`,
        prompt,
        lane: 'real',
        quality: 'fast',
        seed: n,
        steps: 4,
        images: [],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch
}

beforeEach(() => {
  calls = []
  failOn = new Set()
  stubFetch()
  // The batch route resolves against the page URL; Bun has no document.
  ;(globalThis as any).document = { baseURI: 'http://127.0.0.1:3080/' }
})
afterEach(() => {
  globalThis.fetch = realFetch
})

/** Wait until every slot has left `pending`, or the budget runs out. */
async function settle(key: string, budgetMs = 2000) {
  const started = Date.now()
  while (Date.now() - started < budgetMs) {
    const slots = batchSlots(key)
    if (slots && slots.every((slot) => slot.status !== 'pending')) return slots
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('batch did not settle')
}

const req = (prompt: string) => ({ prompt, lane: 'real', quality: 'fast', count: 4 })

describe('startBatch', () => {
  test('queues one job per frame, sequentially, and publishes each as it lands', async () => {
    const prompt = 'four mugs'
    const batch = startBatch(req(prompt), 4)
    const seen: number[] = []
    subscribeBatch(batch.key, () => seen.push(batchVersion(batch.key)))

    const slots = await settle(batch.key)
    expect(slots).toHaveLength(4)
    expect(slots.every((slot) => slot.status === 'done')).toBe(true)
    expect(slots.map((slot) => slot.url).filter(Boolean)).toHaveLength(4)
    // One POST per frame, each asking for a single image: that is what makes the frames land
    // separately. A single job with count 4 would defeat the whole module.
    expect(calls).toHaveLength(4)
    expect(calls.every((call) => call.body.req.count === 1)).toBe(true)
    // One emit per finished frame, so the grid fills in rather than appearing at once.
    expect(seen.length).toBe(4)
  })

  test('a second caller joins the running batch instead of queueing it again', async () => {
    const prompt = 'join the queue'
    const first = startBatch(req(prompt), 4)
    const second = startBatch(req(prompt), 4)
    expect(second.key).toBe(first.key)
    await settle(first.key)
    expect(calls).toHaveLength(4)
  })

  test('a stored turn never queues: pending slots become holes', async () => {
    const batch = startBatch(req('replay only'), 4, { dispatch: false })
    expect(calls).toHaveLength(0)
    expect(batchSlots(batch.key)?.every((slot) => slot.status === 'missing')).toBe(true)
  })

  test('one failed frame does not take the rest of the batch down', async () => {
    failOn = new Set([2])
    const batch = startBatch(req('one bad frame'), 3)
    const slots = await settle(batch.key)
    expect(slots.map((slot) => slot.status)).toEqual(['done', 'error', 'done'])
    expect(slots[1].error).toContain('comfy said no')
  })

  test('each frame has its own cache key, so a retry never re-renders a finished one', async () => {
    const request = req('slot keys')
    const batch = startBatch(request, 3)
    await settle(batch.key)
    expect(calls).toHaveLength(3)
    expect(slotKey(request, 0)).not.toBe(slotKey(request, 1))

    // Asking again answers from the per-slot cache: no new work on the GPU.
    const again = startBatch(request, 3)
    await settle(again.key)
    expect(calls).toHaveLength(3)
    expect(batchSlots(again.key)?.every((slot) => slot.status === 'done')).toBe(true)
  })
})

describe('per-frame prompts', () => {
  test('one prompt is reused for every frame, so the seeds do the varying', async () => {
    const request = req('same scene, four samples')
    const batch = startBatch(request, 3)
    const slots = await settle(batch.key)
    expect(calls.map((call) => call.body.req.prompt)).toEqual([
      'same scene, four samples',
      'same scene, four samples',
      'same scene, four samples',
    ])
    expect(slots.every((slot) => slot.prompt === 'same scene, four samples')).toBe(true)
    // The host picks a fresh seed per job, so the frames differ without being told to.
    expect(calls.every((call) => call.body.req.seed === undefined)).toBe(true)
  })

  test('a listed prompt is used by its own frame', async () => {
    const prompts = ['catgirl in Tokyo', 'catgirl in Lagos', 'catgirl in Oslo']
    const batch = startBatch({ lane: 'anime', quality: 'fast', prompt: prompts[0], prompts }, 3)
    const slots = await settle(batch.key)
    expect(calls.map((call) => call.body.req.prompt)).toEqual(prompts)
    expect(slots.map((slot) => slot.prompt)).toEqual(prompts)
    expect(slots.every((slot) => slot.status === 'done')).toBe(true)
  })

  test('editing one prompt is a different batch, not a replay of the old frames', () => {
    const first = ['a red fox', 'a grey fox']
    const second = ['a red fox', 'a black fox']
    const keyA = batchKey({ lane: 'real', quality: 'fast', prompt: first[0], prompts: first })
    const keyB = batchKey({ lane: 'real', quality: 'fast', prompt: second[0], prompts: second })
    expect(keyA).not.toBe(keyB)
  })
})
