/**
 * The ComfyUI HTTP client, ported from `Comfy::queue/wait/fetch/upload` in `comfy.rs`.
 *
 * `wait` polls `/history/:id` because ComfyUI reports progress nowhere else without a
 * websocket; the poll interval is the only knob that matters at these render times.
 */

export interface ImageRef {
  filename: string
  subfolder: string
  type: string
}

export type HistoryState =
  | { state: 'pending' }
  | { state: 'failed'; message: string }
  | { state: 'done'; images: ImageRef[] }

export interface ComfyClientOptions {
  base: string
  /** Default poll interval for `wait`, in ms. */
  pollMs?: number
  signal?: AbortSignal
}

export interface ComfyClient {
  queue(graph: unknown, signal?: AbortSignal): Promise<string>
  wait(promptId: string, timeoutMs: number, pollMs?: number): Promise<ImageRef[]>
  fetch(image: ImageRef): Promise<Uint8Array>
  upload(filename: string, bytes: Uint8Array): Promise<string>
}

export function viewUrl(base: string, image: ImageRef): string {
  return `${base}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(
    image.subfolder,
  )}&type=${encodeURIComponent(image.type)}`
}

export function parseHistoryEntry(entry: unknown): HistoryState {
  if (!entry || typeof entry !== 'object') return { state: 'pending' }
  const record = entry as Record<string, any>
  const status = record.status
  if (!status || typeof status !== 'object') return { state: 'pending' }
  if (status.status_str === 'error') {
    return { state: 'failed', message: 'comfyui reported an execution error' }
  }
  if (status.completed !== true) return { state: 'pending' }

  const images: ImageRef[] = []
  const outputs = record.outputs
  if (outputs && typeof outputs === 'object') {
    for (const node of Object.values(outputs as Record<string, any>)) {
      const list = node?.images
      if (!Array.isArray(list)) continue
      for (const image of list) {
        images.push({
          filename: String(image?.filename ?? ''),
          subfolder: String(image?.subfolder ?? ''),
          type: String(image?.type ?? 'output'),
        })
      }
    }
  }
  if (images.length === 0) {
    return { state: 'failed', message: 'comfyui finished with no images' }
  }
  return { state: 'done', images }
}

async function jsonBody(response: Response, what: string): Promise<any> {
  try {
    return await response.json()
  } catch (err) {
    throw new Error(`comfy ${what} was not json (${response.status}): ${String(err)}`)
  }
}

export function createComfyClient(options: ComfyClientOptions): ComfyClient {
  const base = options.base.replace(/\/+$/, '')
  const defaultPoll = options.pollMs ?? 750
  const clientId = `dsh-genui-${Math.random().toString(36).slice(2)}`

  const call = (path: string, init: RequestInit = {}, signal?: AbortSignal) =>
    fetch(`${base}${path}`, { ...init, signal: signal ?? options.signal })

  return {
    async queue(graph, signal) {
      const res = await call(
        '/api/prompt',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: graph, client_id: clientId }),
        },
        signal,
      ).catch((err) => {
        throw new Error(`comfy queue request failed: ${String(err)}`)
      })

      const body = await jsonBody(res, 'queue response')
      if (!res.ok) throw new Error(`comfy rejected the graph (${res.status}): ${JSON.stringify(body)}`)
      const nodeErrors = body?.node_errors
      if (nodeErrors && typeof nodeErrors === 'object' && Object.keys(nodeErrors).length > 0) {
        throw new Error(`comfy node_errors: ${JSON.stringify(nodeErrors)}`)
      }
      if (typeof body?.prompt_id !== 'string') {
        throw new Error(`comfy returned no prompt_id: ${JSON.stringify(body)}`)
      }
      return body.prompt_id
    },

    async wait(promptId, timeoutMs, pollMs) {
      const interval = pollMs ?? defaultPoll
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const res = await call(`/history/${encodeURIComponent(promptId)}`).catch((err) => {
          throw new Error(`comfy history request failed: ${String(err)}`)
        })
        const body = await jsonBody(res, 'history')
        const parsed = parseHistoryEntry(body?.[promptId])
        if (parsed.state === 'done') return parsed.images
        if (parsed.state === 'failed') throw new Error(parsed.message)
        if (Date.now() >= deadline) {
          throw new Error(`comfy timed out after ${Math.round(timeoutMs / 1000)}s`)
        }
        await new Promise((resolve) => setTimeout(resolve, interval))
      }
    },

    async fetch(image) {
      const res = await call(viewUrl('', image)).catch((err) => {
        throw new Error(`comfy view request failed: ${String(err)}`)
      })
      if (!res.ok) throw new Error(`comfy view returned ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    },

    /** Put a local file in ComfyUI's `input/` so LoadImage can reference it. */
    async upload(filename, bytes) {
      const form = new FormData()
      form.set('type', 'input')
      form.set('overwrite', 'true')
      form.set('image', new Blob([bytes as unknown as BlobPart], { type: 'image/png' }), filename)

      const res = await call('/upload/image', { method: 'POST', body: form }).catch((err) => {
        throw new Error(`comfy upload failed: ${String(err)}`)
      })
      const body = await jsonBody(res, 'upload response')
      if (!res.ok) throw new Error(`comfy upload rejected (${res.status}): ${JSON.stringify(body)}`)
      const name = typeof body?.name === 'string' ? body.name : ''
      if (!name) throw new Error(`comfy upload returned no name: ${JSON.stringify(body)}`)
      const subfolder = typeof body?.subfolder === 'string' ? body.subfolder : ''
      return subfolder ? `${subfolder}/${name}` : name
    },
  }
}
