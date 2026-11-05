/**
 * The retry wrapper around a render.
 *
 * A render that fails once must not become a red box under a picture the user asked for —
 * but a request the host will always reject must not be repeated four times either. These
 * cases are the two sides of that line.
 */
import { describe, expect, test } from 'bun:test'
import { withRetry } from '../src/client/retry'

/** Fast retries: the delays are what is being skipped, not what is being tested. */
const quick = () => withRetry as typeof withRetry

async function counting(error: string, times = 99) {
  let calls = 0
  const run = async () => {
    calls += 1
    if (calls <= times) throw new Error(error)
    return 'ok'
  }
  return { run, calls: () => calls }
}

describe('withRetry', () => {
  test('a route that is not mounted yet is retried', async () => {
    // The harness restarting without the bundle mounted answers 404 for a moment. Every
    // frame of a batch posted through that window and failed for good.
    const { run, calls } = await counting('genui request failed: 404', 2)
    const result = await quick()(run, 4, 1)
    expect(result).toBe('ok')
    expect(calls()).toBe(3)
  })

  test('an unusable sample is retried: the next attempt asks for a new seed', async () => {
    const { run, calls } = await counting(
      'every frame of the batch came back unusable (genui_1.png (9000 bytes))',
      1,
    )
    expect(await quick()(run, 3, 1)).toBe('ok')
    expect(calls()).toBe(2)
  })

  test('a 5xx is retried, a rejected graph is not', async () => {
    const server = await counting('genui request failed: 503', 1)
    expect(await quick()(server.run, 3, 1)).toBe('ok')

    const rejected = await counting('comfy rejected the graph (400)')
    await expect(quick()(rejected.run, 4, 1)).rejects.toThrow('400')
    expect(rejected.calls()).toBe(1)
  })

  test('the last error is what the caller sees', async () => {
    const { run, calls } = await counting('fetch failed')
    await expect(quick()(run, 2, 1)).rejects.toThrow('fetch failed')
    expect(calls()).toBe(2)
  })
})
