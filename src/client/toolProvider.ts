/**
 * The `Query()` side effects, per rendered answer.
 *
 * Two rules:
 *  - the cache answers first, so a replay of a saved answer costs no GPU time;
 *  - only a turn that may generate is allowed to POST. A historical turn whose render is
 *    gone gets a `missing` result, which the image components paint as a hole with a retry
 *    control. That is the difference between opening a conversation and re-rendering it.
 */
import { cachedRender, hydratedOnce, imageKey, lookupRender, type Rendered } from './imageCache'
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
  if (!mayGenerate()) return missing(args)
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
