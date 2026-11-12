/**
 * `/genui/mode` on the harness web server: the *only* HTTP surface this bundle owns.
 *
 * The route is unauthenticated, so it is only acceptable on a loopback bind: a request must be
 * same-origin (`Origin`/`Sec-Fetch-Site`) and every POST must declare JSON. The browser cannot
 * be tricked into posting here from another site, and a non-browser caller that is already
 * running locally can do whatever it likes anyway.
 *
 * Generation routes (`/genui/generate` and friends) belong to the optional image bundle, which
 * carries its own copy of these guards so that it can be installed, removed or written against
 * this one without either half reaching into the other's files.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { ModeStore } from './mode'

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
export function payload(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'expected a json object')
  const record = body as Record<string, unknown>
  const inner = record.req ?? record.request
  if (inner && typeof inner === 'object') return inner as Record<string, unknown>
  return record
}

async function guardWith(
  req: IncomingMessage,
  res: ServerResponse,
  run: () => Promise<void>,
  log: { warn: (message: string) => void },
): Promise<void> {
  try {
    assertSameOrigin(req)
    await run()
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    const message = err instanceof Error ? err.message : String(err)
    // A 5xx here is the only record a browser-side failure leaves; keep it next to the rest
    // of the boot log instead of only in the tab.
    if (status >= 500) log.warn(`${req.method} ${req.url} -> ${status}: ${message}`)
    if (!res.headersSent) sendText(res, status, message)
    else res.end()
  }
}

export function registerRoutes(ctx: Context, mode: ModeStore): (() => void)[] {
  const log = ctx.logger('dsh-genui')

  return [
    ctx.webServer.register({
      kind: 'exact',
      path: '/genui/mode',
      handler: (req, res) =>
        guardWith(req, res, async () => {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          if (req.method === 'GET') {
            const session = url.searchParams.get('session')
            if (!session) {
              sendJson(res, 200, {
                default: mode.defaultOn,
                sessions: mode.sessions(),
                off: mode.offSessions(),
              })
              return
            }
            sendJson(res, 200, { session, openui: mode.isOn(session) })
            return
          }
          const body = payload(await readJson(req))
          const session = typeof body.session === 'string' ? body.session : ''
          if (!session) throw new HttpError(400, 'session is required')
          if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'enabled must be a boolean')
          mode.set(session, body.enabled)
          sendJson(res, 200, { session, openui: mode.isOn(session) })
        }, log),
    }),
  ]
}
