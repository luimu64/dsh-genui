/**
 * The `Query()` side effects, per rendered answer.
 *
 * Three rules:
 *  - the cache answers first, so a replay of a saved answer costs no GPU time;
 *  - only a turn that may generate is allowed to POST. A historical turn whose render is
 *    gone gets a `missing` result, which the image components paint as a hole with a retry
 *    control. That is the difference between opening a conversation and re-rendering it;
 *  - a `count` above 1 is not one job. The batch is handed to `batches.ts`, which runs the
 *    frames one at a time and publishes each as it lands, so the grid fills in instead of
 *    appearing all at once at the end.
 */
import { cachedRender, hydratedOnce, imageKey, lookupRender, type Rendered } from './imageCache'
import { startBatch, batchKey, promptsOf } from './batches'
import { withRetry } from './retry'

function post(path: string, body: unknown): Promise<Rendered> {
  return fetch(new URL(path, document.baseURI), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (res) => {
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) throw new Error(String(json.error ?? `genui request failed: ${res.status}`))
    return json as unknown as Rendered
  })
}

function missing(args: Record<string, unknown>): Rendered {
  return {
    url: '',
    file: '',
    prompt: String(args.prompt ?? ''),
    lane: String(args.lane ?? 'real'),
    quality: typeof args.quality === 'string' ? args.quality : undefined,
    preset: typeof args.preset === 'string' ? args.preset : undefined,
    upscale: typeof args.upscale === 'number' ? args.upscale : undefined,
    seed: 0,
    steps: 0,
    missing: true,
    images: [],
  }
}

function requiredPrompt(args: Record<string, unknown>, tool: string): void {
  if (typeof args.prompt !== 'string' || args.prompt.trim() === '') {
    throw new Error(`${tool} needs a prompt`)
  }
}

/**
 * A batch, as the program sees it: one slot per requested image, in request order. A frame
 * that is already rendered carries its url; the rest carry the batch key and their index, so
 * `GenImageSet` can subscribe to the queue and paint each picture the moment it lands.
 *
 * `prompts` (one per picture) sets the size of the batch when it is given; `count` otherwise.
 * Either way the query resolves immediately: waiting for all N frames is exactly the
 * all-at-once behaviour this replaces.
 */
function batchResult(args: Record<string, unknown>, mayGenerate: boolean): Rendered {
  const listed = promptsOf(args)
  const count = Math.max(1, Math.round(listed.length > 1 ? listed.length : Number(args.count) || 1))
  const key = batchKey(args)
  const batch = startBatch(args, count, { dispatch: mayGenerate })
  return {
    url: '',
    file: '',
    prompt: String(args.prompt ?? listed[0] ?? ''),
    lane: String(args.lane ?? 'real'),
    quality: typeof args.quality === 'string' ? args.quality : undefined,
    preset: typeof args.preset === 'string' ? args.preset : undefined,
    upscale: typeof args.upscale === 'number' ? args.upscale : undefined,
    seed: 0,
    steps: 0,
    images: batch.slots.map((slot) => ({
      url: slot.url ?? '',
      file: slot.file,
      batch: key,
      index: slot.index,
      total: batch.total,
    })),
  }
}

async function render(
  args: Record<string, unknown>,
  path: string,
  mayGenerate: () => boolean,
  tool: string,
): Promise<Rendered> {
  requiredPrompt(args, tool)
  await hydratedOnce()
  const key = imageKey(args)
  const hit = await lookupRender(key)
  if (hit) return hit
  const allowed = mayGenerate()
  // A batch the cache does not know is queued frame by frame; the single-image path is
  // unchanged, because one job is already progressive. A prompt per picture is a batch too,
  // even when the caller left the count out.
  const listed = promptsOf(args)
  if (tool === 'generate_image' && (listed.length > 1 || Number(args.count) > 1)) {
    return batchResult(args, allowed)
  }
  if (!allowed) return missing(args)
  return cachedRender(key, () => withRetry(() => post(path, { req: args })))
}

/** The shape the OpenUI renderer takes as `toolProvider`. */
export interface ToolProvider {
  [tool: string]: (args: Record<string, unknown>) => Promise<unknown>
  generate_image(args: Record<string, unknown>): Promise<Rendered>
  edit_image(args: Record<string, unknown>): Promise<Rendered>
}

/**
 * `isTail` is the fallback for a provider that never paints a step as `running`: the newest
 * answer is the one the user is looking at, so it may queue work even when the gate never saw
 * it stream. It is read at request time rather than when the provider is built, because it
 * inspects the DOM and the query fires after React has committed the row.
 */
export function makeToolProvider(opts: {
  allowGeneration: boolean
  isTail?: () => boolean
}): ToolProvider {
  const mayGenerate = () => opts.allowGeneration || (opts.isTail?.() ?? false)
  return {
    generate_image: (args) => render(args, '/genui/generate', mayGenerate, 'generate_image'),
    edit_image: (args) => render(args, '/genui/edit', mayGenerate, 'edit_image'),
  }
}
