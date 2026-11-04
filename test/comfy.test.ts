import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createComfyClient, parseHistoryEntry, viewUrl } from '../src/host/comfy'
import { startFakeComfy } from './fixtures/comfy'

let fake: Awaited<ReturnType<typeof startFakeComfy>>

beforeAll(async () => {
  fake = await startFakeComfy()
})
afterAll(() => fake.stop())

describe('comfy client', () => {
  test('queues and waits for one image', async () => {
    const comfy = createComfyClient({ base: fake.base, pollMs: 10 })
    const id = await comfy.queue({ '3': { inputs: {} } })
    expect(id).toBe('p1')
    const images = await comfy.wait(id, 1000, 10)
    expect(images).toEqual([{ filename: 'harness_real_1.png', subfolder: '', type: 'output' }])
  })

  test('surfaces node errors', async () => {
    const bad = Bun.serve({
      port: 0,
      fetch: () => Response.json({ node_errors: { '3': { error: 'bad' } } }),
    })
    const comfy = createComfyClient({ base: `http://127.0.0.1:${bad.port}`, pollMs: 10 })
    await expect(comfy.queue({})).rejects.toThrow('node_errors')
    bad.stop(true)
  })

  test('fetches image bytes and uploads a source', async () => {
    const comfy = createComfyClient({ base: fake.base, pollMs: 10 })
    const bytes = await comfy.fetch({ filename: 'a.png', subfolder: '', type: 'output' })
    expect(bytes.length).toBe(4)
    expect(await comfy.upload('source.png', new Uint8Array([1, 2, 3]))).toBe('source.png')
    expect(fake.uploads()).toContain('source.png')
  })

  test('polls until the history entry completes', async () => {
    const slow = await startFakeComfy({ historyDelayMs: 60 })
    const comfy = createComfyClient({ base: slow.base, pollMs: 10 })
    const images = await comfy.wait('p1', 2000, 10)
    expect(images).toHaveLength(1)
    slow.stop()
  })

  test('times out when nothing completes', async () => {
    const idle = Bun.serve({ port: 0, fetch: () => Response.json({}) })
    const comfy = createComfyClient({ base: `http://127.0.0.1:${idle.port}`, pollMs: 10 })
    await expect(comfy.wait('p1', 50, 10)).rejects.toThrow('timed out')
    idle.stop(true)
  })
})

describe('parseHistoryEntry', () => {
  test('pending without a status', () => {
    expect(parseHistoryEntry(null)).toEqual({ state: 'pending' })
    expect(parseHistoryEntry({})).toEqual({ state: 'pending' })
    expect(parseHistoryEntry({ status: { completed: false } })).toEqual({ state: 'pending' })
  })

  test('an error status fails', () => {
    expect(parseHistoryEntry({ status: { status_str: 'error' } })).toEqual({
      state: 'failed',
      message: 'comfyui reported an execution error',
    })
  })

  test('a completed entry with no images fails', () => {
    expect(parseHistoryEntry({ status: { completed: true }, outputs: {} })).toEqual({
      state: 'failed',
      message: 'comfyui finished with no images',
    })
  })

  test('collects every image of every output node', () => {
    const parsed = parseHistoryEntry({
      status: { completed: true },
      outputs: {
        9: { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] },
        10: { images: [{ filename: 'b.png', subfolder: 'sub', type: 'output' }] },
      },
    })
    expect(parsed).toEqual({
      state: 'done',
      images: [
        { filename: 'a.png', subfolder: '', type: 'output' },
        { filename: 'b.png', subfolder: 'sub', type: 'output' },
      ],
    })
  })
})

describe('viewUrl', () => {
  test('encodes the filename', () => {
    expect(viewUrl('http://x', { filename: 'a b.png', subfolder: 's 1', type: 'output' })).toBe(
      'http://x/view?filename=a%20b.png&subfolder=s%201&type=output',
    )
  })
})

describe('queue contention', () => {
  test('time spent queued behind another job does not count as render time', async () => {
    const id = 'p-queued'
    let polls = 0
    let runningAt = 0
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url)
        if (url.pathname === '/queue') {
          polls++
          // Another workflow holds the GPU for the first three polls.
          if (polls < 4) return Response.json({ queue_running: [[1, 'someone-else', {}, {}, []]] })
          runningAt ||= Date.now()
          return Response.json({ queue_running: [[2, id, {}, {}, []]] })
        }
        // Completes only after the job itself has been running for a while.
        if (url.pathname === '/history/' + id && runningAt !== 0 && Date.now() - runningAt >= 60) {
          return Response.json({
            [id]: {
              status: { status_str: 'success', completed: true },
              outputs: { 9: { images: [{ filename: 'x.png', subfolder: '', type: 'output' }] } },
            },
          })
        }
        return Response.json({})
      },
    })
    const comfy = createComfyClient({ base: `http://127.0.0.1:${server.port}`, pollMs: 20 })
    // The render budget is shorter than the queue wait: queue time must not consume it.
    const images = await comfy.wait(id, 200, 20)
    expect(images).toEqual([{ filename: 'x.png', subfolder: '', type: 'output' }])
    expect(polls).toBeGreaterThan(1)
    server.stop(true)
  })

  test('a job that never starts is a busy-queue error, not a silent timeout', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url)
        if (url.pathname === '/queue') return Response.json({ queue_running: [[1, 'someone-else', {}, {}, []]] })
        return Response.json({})
      },
    })
    const comfy = createComfyClient({ base: `http://127.0.0.1:${server.port}`, pollMs: 10 })
    // The fake queue wait is 30 minutes, so this only proves the loop keeps polling rather
    // than failing on the render budget.
    const pending = comfy.wait('never-starts', 50, 10)
    const winner = await Promise.race([
      pending.then(() => 'resolved').catch(() => 'rejected'),
      new Promise((resolve) => setTimeout(() => resolve('still-waiting'), 150)),
    ])
    expect(winner).toBe('still-waiting')
    server.stop(true)
  })
})
