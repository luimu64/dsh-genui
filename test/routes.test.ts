/**
 * The `/genui/*` routes as the browser actually calls them.
 *
 * The cache key travels beside `req` in the wire body (`{req, key}`), and `payload()`
 * unwraps straight to the request — so the key is easy to lose on the way to the service.
 * It was lost: every render went unindexed and `/genui/cached` always answered empty, which
 * only showed up as "the recovery feature does nothing". These tests call the registered
 * handler with a real request envelope instead of trusting the wiring.
 */
import { describe, expect, test } from 'bun:test'
import { registerRoutes } from '../src/host/routes'
import { testConfig } from './helpers'

type Handler = (req: any, res: any) => Promise<void> | void

function harness(service: Record<string, unknown>) {
  const routes = new Map<string, Handler>()
  const ctx = {
    logger: () => ({ warn: () => {}, info: () => {}, debug: () => {} }),
    webServer: {
      register: (route: { path: string; handler: Handler }) => {
        routes.set(route.path, route.handler)
        return () => {}
      },
    },
  }
  const mode = { defaultOn: true, isOn: () => true, set: () => {}, sessions: () => [], offSessions: () => [] }
  registerRoutes(ctx as any, service as any, testConfig(), mode as any)
  return routes
}

/** A request the same-origin guard is happy with, carrying `body` as JSON. */
function request(path: string, body: unknown) {
  const text = JSON.stringify(body)
  return {
    method: 'POST',
    url: path,
    headers: {
      origin: 'http://127.0.0.1:3080',
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
    },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(text, 'utf8')
    },
  } as any
}

function response() {
  const chunks: string[] = []
  let status = 0
  return {
    res: {
      headersSent: false,
      writeHead: (code: number) => {
        status = code
      },
      end: (text?: string) => {
        if (text) chunks.push(text)
      },
    } as any,
    status: () => status,
    json: () => JSON.parse(chunks.join('') || '{}'),
  }
}

describe('transport of the cache key', () => {
  test('generate receives the key that rides beside req', async () => {
    let seen: { req: unknown; key: unknown } | null = null
    const routes = harness({
      generate: async (req: unknown, key: unknown) => {
        seen = { req, key }
        return { url: '/genui/images/x.png', file: 'x.png', images: [] }
      },
    })
    const out = response()
    await routes.get('/genui/generate')!(request('/genui/generate', { req: { prompt: 'a fox' }, key: 'k1' }), out.res)
    expect(out.status()).toBe(200)
    expect(seen).toEqual({ req: { prompt: 'a fox' }, key: 'k1' })
  })

  test('edit receives it too', async () => {
    let seenKey: unknown
    const routes = harness({
      edit: async (_req: unknown, key: unknown) => {
        seenKey = key
        return { url: '/genui/images/y.png', file: 'y.png', images: [] }
      },
    })
    await routes.get('/genui/edit')!(request('/genui/edit', { req: { prompt: 'darker' }, key: 'k2' }), response().res)
    expect(seenKey).toBe('k2')
  })

  test('a bare request without the envelope still works, with no key', async () => {
    let seenKey: unknown = 'unset'
    const routes = harness({
      generate: async (_req: unknown, key: unknown) => {
        seenKey = key
        return { url: '', file: '', images: [] }
      },
    })
    await routes.get('/genui/generate')!(request('/genui/generate', { prompt: 'a fox' }), response().res)
    expect(seenKey).toBeUndefined()
  })

  test('cached answers with the renders this machine has', async () => {
    const routes = harness({
      cached: (keys: string[]) => ({ 'k1': { url: '/genui/images/x.png', file: 'x.png' }, seen: keys }),
    })
    const out = response()
    await routes.get('/genui/cached')!(request('/genui/cached', { keys: ['k1', 'k2'] }), out.res)
    const body = out.json()
    expect(body.renders['k1'].file).toBe('x.png')
    expect(body.renders.seen).toEqual(['k1', 'k2'])
  })

  test('cached refuses an empty lookup instead of scanning everything', async () => {
    const routes = harness({ cached: () => ({}) })
    const out = response()
    await routes.get('/genui/cached')!(request('/genui/cached', {}), out.res)
    expect(out.status()).toBe(400)
  })
})

describe('end to end: a keyed render is recoverable', () => {
  test('render -> index.json -> /genui/cached', async () => {
    const { createGenuiService } = await import('../src/host/service')
    const { startFakeComfy } = await import('./fixtures/comfy')
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const dir = mkdtempSync(join(tmpdir(), 'genui-e2e-'))
    const fake = await startFakeComfy({ imageBytes: new Uint8Array([137, 80, 78, 71]), filename: 'genui_real_e2e.png' })
    try {
      const service = createGenuiService(
        testConfig({ comfyBase: fake.base, imagesDir: dir, pollMs: 10, minPngBytes: 4 }),
      )
      const routes = harness(service as unknown as Record<string, unknown>)
      const key = '["real","e2e cup","fast",1,832,1216,null,null,null,null,null,1]'

      const made = response()
      await routes.get('/genui/generate')!(
        request('/genui/generate', { req: { lane: 'real', prompt: 'e2e cup', count: 1 }, key }),
        made.res,
      )
      expect(made.status()).toBe(200)
      const render = made.json()
      expect(render.file).toBe('genui_real_e2e.png')

      // The index exists on disk and points at the saved file...
      const { readFileSync } = await import('node:fs')
      const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))
      expect(index[key].file).toBe('genui_real_e2e.png')

      // ...and a browser with no cache of its own gets the picture back.
      const asked = response()
      await routes.get('/genui/cached')!(request('/genui/cached', { keys: [key] }), asked.res)
      expect(asked.json().renders[key].url).toBe(render.url)
    } finally {
      fake.stop()
    }
  })
})
