/**
 * `/genui/*` routes on the harness web server.
 *
 * These routes are unauthenticated, so they are only acceptable on a loopback bind: every
 * request must be same-origin (`Origin`/`Sec-Fetch-Site`) and every POST must declare JSON.
 * The browser cannot be tricked into posting here from another site, and a non-browser caller
 * that is already running locally can do whatever it likes anyway.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { readRender } from './images'
import type { ModeStore } from './mode'
import type { GenuiConfig, GenuiService } from './service'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const MAX_BODY_BYTES = 1024 * 1024

export function isLoopbackHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '')
  return bare === 'localhost' || bare === '::1' || /^127\./.test(bare)
}

export function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== 'null') {
    let parsed: URL
    try {
      parsed = new URL(origin)
    } catch {
      throw new HttpError(403, 'invalid origin')
    }
    if (!isLoopbackHost(parsed.hostname)) throw new HttpError(403, 'cross-origin request')
  }
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
    throw new HttpError(403, 'cross-site request')
  }
}

/** Read a JSON body, refusing anything that is not declared as JSON. */
export async function readJson(req: IncomingMessage): Promise<unknown> {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') {
    throw new HttpError(415, 'content-type must be application/json')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'invalid json')
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(text)
}

function sendText(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message })
}

/** Unwrap `{ req: {...} }` (the wire shape) and tolerate a bare request body. */
function payload(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'expected a json object')
  const record = body as Record<string, unknown>
  const inner = record.req ?? record.request
  if (inner && typeof inner === 'object') return inner as Record<string, unknown>
  return record
}

async function guard(
  req: IncomingMessage,
  res: ServerResponse,
  run: () => Promise<void>,
): Promise<void> {
  try {
    assertSameOrigin(req)
    await run()
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    const message = err instanceof Error ? err.message : String(err)
    if (!res.headersSent) sendText(res, status, message)
    else res.end()
  }
}

export function registerRoutes(
  ctx: Context,
  service: GenuiService,
  config: GenuiConfig,
  mode: ModeStore,
): (() => void)[] {
  const post = (path: string, run: (body: Record<string, unknown>) => Promise<unknown>) =>
    ctx.webServer.register({
      kind: 'exact',
      path,
      handler: (req, res) =>
        guard(req, res, async () => {
          const body = payload(await readJson(req))
          sendJson(res, 200, await run(body))
        }),
    })

  return [
    post('/genui/generate', (body) => service.generate(body as any)),
    post('/genui/edit', (body) => service.edit(body as any)),

    ctx.webServer.register({
      kind: 'exact',
      path: '/genui/mode',
      handler: (req, res) =>
        guard(req, res, async () => {
          if (req.method === 'GET') {
            sendJson(res, 200, { openui: mode.enabled() })
            return
          }
          const body = payload(await readJson(req))
          if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'enabled must be a boolean')
          mode.set(body.enabled)
          sendJson(res, 200, { openui: mode.enabled() })
        }),
    }),

    ctx.webServer.register({
      kind: 'exact',
      path: '/genui/health',
      handler: (req, res) =>
        guard(req, res, async () => {
          sendJson(res, 200, await service.health())
        }),
    }),

    ctx.webServer.register({
      kind: 'prefix',
      path: '/genui/images',
      handler: (req, res) =>
        guard(req, res, async () => {
          const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
          const prefix = '/genui/images/'
          if (!pathname.startsWith(prefix)) throw new HttpError(404, 'not found')
          let name: string
          try {
            name = decodeURIComponent(pathname.slice(prefix.length))
          } catch {
            throw new HttpError(400, 'bad image name')
          }
          if (!name) throw new HttpError(404, 'not found')
          let bytes: Uint8Array
          try {
            bytes = await readRender(config.imagesDir, name)
          } catch {
            throw new HttpError(404, 'no such image')
          }
          res.writeHead(200, {
            'content-type': 'image/png',
            'content-length': bytes.byteLength,
            'cache-control': 'public, max-age=31536000, immutable',
            'x-content-type-options': 'nosniff',
          })
          res.end(Buffer.from(bytes))
        }),
    }),
  ]
}
