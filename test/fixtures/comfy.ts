/**
 * A stand-in for ComfyUI's HTTP surface, shared by the client and service tests. It answers
 * the four calls the host makes, counts queued prompts, and hands back a fixed history entry.
 */

export interface FakeComfyOptions {
  /** Bytes served by `/view`. Small values keep the min-PNG floor configurable. */
  imageBytes?: number | Uint8Array
  /** Filename the history entry reports. */
  filename?: string
  /** Extra delay before a history entry reports completion, in ms. */
  historyDelayMs?: number
  /** Answer `/api/prompt` with this JSON instead of a prompt id. */
  promptResponse?: unknown
  /** Answer `/history/:id` with this body instead of a completed entry. */
  historyEntry?: unknown
}

export interface FakeComfy {
  base: string
  stop: () => void
  /** How many prompt rows reached `/api/prompt`. */
  queueCount: () => number
  /** Graph bodies posted to `/api/prompt`, in order. */
  queued: () => unknown[]
  /** Uploaded file names, in order. */
  uploads: () => string[]
}

function bytesOf(imageBytes: number | Uint8Array): Uint8Array {
  return typeof imageBytes === 'number' ? new Uint8Array(imageBytes) : imageBytes
}

export async function startFakeComfy(options: FakeComfyOptions = {}): Promise<FakeComfy> {
  const image = bytesOf(options.imageBytes ?? 4)
  const filename = options.filename ?? 'harness_real_1.png'
  const queued: unknown[] = []
  const uploads: string[] = []
  const started = Date.now()

  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url)
      if (req.method === 'POST' && url.pathname === '/api/prompt') {
        queued.push(await req.json().catch(() => null))
        if (options.promptResponse !== undefined) return Response.json(options.promptResponse)
        return Response.json({ prompt_id: 'p1', number: queued.length, node_errors: {} })
      }
      if (req.method === 'GET' && url.pathname.startsWith('/history/')) {
        if (options.historyEntry !== undefined) return Response.json(options.historyEntry)
        const ready = Date.now() - started >= (options.historyDelayMs ?? 0)
        const id = url.pathname.slice('/history/'.length)
        return Response.json(
          ready
            ? {
                [id]: {
                  status: { status_str: 'success', completed: true },
                  outputs: { 9: { images: [{ filename, subfolder: '', type: 'output' }] } },
                },
              }
            : {},
        )
      }
      if (req.method === 'GET' && url.pathname === '/view') {
        return new Response(image as unknown as BodyInit, {
          headers: { 'content-type': 'image/png' },
        })
      }
      if (req.method === 'POST' && url.pathname === '/upload/image') {
        const form = await req.formData().catch(() => null)
        const file = form?.get('image') as File | null
        if (file) uploads.push(file.name)
        return Response.json({ name: 'source.png', subfolder: '' })
      }
      return new Response('not found', { status: 404 })
    },
  })

  return {
    base: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
    queueCount: () => queued.length,
    queued: () => queued,
    uploads: () => uploads,
  }
}
