/**
 * Progressive batch rendering.
 *
 * One ComfyUI job with `batch_size: N` only hands back its pictures when the whole batch
 * finishes, so a four-image request showed nothing for a minute and then four frames at
 * once. The lane is a single GPU, so the honest way to make pictures appear as they are
 * made is to run N separate jobs, strictly one after another, and publish each result the
 * moment it lands.
 *
 * This module owns that queue. It is intentionally outside React: the component that paints
 * a batch subscribes here, and a state update per finished image would re-render and
 * re-parse the whole answer (and re-run its queries) for every frame. Each slot has a
 * stable index, its own cache key, and its own terminal state, so:
 *
 *  - finished images stay on screen while the rest are still rendering;
 *  - a rerender (streaming, scrolling, a theme change) joins the batch already running
 *    instead of queueing the same work again;
 *  - reloading the app re-runs the batch, hits the per-slot cache for everything that was
 *    already rendered, and only generates what is genuinely missing;
 *  - one failed slot does not take the whole batch down: it keeps its error and the other
 *    frames are unaffected.
 *
 * Throughput note: sequential jobs on one GPU are slightly slower end to end than a single
 * batched job (the batch shares prompt encoding and one model load, and batching amortises
 * launch overhead), but the first image arrives after ~1/N of the wait instead of after all
 * of it.
 */
import {
  cachedRender,
  imageKey,
  peek,
  recordedImage,
  rememberImage,
  type Rendered,
} from './imageCache'
import { withRetry } from './retry'

export type BatchRequest = Record<string, unknown> & { quality?: string }

export type Slot = {
  index: number
  /**
   * `missing` is terminal and inert: the frame was part of a stored turn whose picture is
   * not on this machine any more. Nothing fills it except a user asking for it.
   */
  status: 'pending' | 'done' | 'error' | 'missing'
  url?: string
  file?: string
  seed?: number
  error?: string
}

type Batch = {
  key: string
  total: number
  slots: Slot[]
  listeners: Set<() => void>
  version: number
  started: boolean
  /** A slot loop is between its first and last job. One runner per batch, ever. */
  running: boolean
}

const batches = new Map<string, Batch>()

/** Batches live for the session; the persisted per-slot cache is what survives a reload. */
const MAX_BATCHES = 32

function emit(batch: Batch) {
  batch.version += 1
  for (const listener of batch.listeners) listener()
}

/**
 * The cache key of one image of a batch: the single-image request plus the slot index.
 * The suffix is outside the key's positional array on purpose — `imageKey`'s shape is what
 * every already-stored render is hashed with, and changing it would orphan all of them.
 */
export function slotKey(req: BatchRequest, index: number): string {
  return `${imageKey({ ...req, count: 1 })}#${index}`
}

/** Everything that makes one batch the same batch: the request, count included. */
export function batchKey(req: BatchRequest): string {
  return imageKey(req)
}

export function subscribeBatch(key: string, listener: () => void): () => void {
  const batch = batches.get(key)
  if (!batch) return () => {}
  batch.listeners.add(listener)
  return () => {
    batch.listeners.delete(listener)
  }
}

export function batchVersion(key: string): number {
  return batches.get(key)?.version ?? 0
}

/** Live slot view for the component that paints the batch. */
export function batchSlots(key: string): Slot[] | null {
  return batches.get(key)?.slots ?? null
}

function newBatch(key: string, total: number): Batch {
  return {
    key,
    total,
    slots: Array.from({ length: total }, (_, index) => ({ index, status: 'pending' as const })),
    listeners: new Set(),
    version: 0,
    started: false,
    running: false,
  }
}

/** One frame of a batch, as the host route takes it. */
async function postFrame(req: BatchRequest): Promise<Rendered> {
  const res = await fetch(new URL('/genui/generate', document.baseURI), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ req: { ...req, count: 1 } }),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(String(json.error ?? `genui request failed: ${res.status}`))
  return json as unknown as Rendered
}

/**
 * Run (or join) the batch for this request. Returns immediately: the pictures arrive
 * through the slot store, one emit per finished frame.
 *
 * `dispatch` is the permission to queue new work. It is true only for the turn the user is
 * producing right now; replaying a stored answer calls this with `dispatch: false`, which
 * hydrates every frame that is already on disk and marks the rest `missing` instead of
 * rendering them. Two things follow: opening a conversation can never restart last week's
 * batches, and an unfinished batch after a restart is a hole with a button, not a silent
 * re-run.
 */
export function startBatch(
  req: BatchRequest,
  count: number,
  opts?: { dispatch?: boolean },
): Batch {
  const dispatch = opts?.dispatch ?? true
  const key = batchKey(req)
  let batch = batches.get(key)

  if (!batch) {
    if (batches.size >= MAX_BATCHES) {
      // Drop the oldest finished batch only; an in-flight one would lose its subscribers.
      for (const [oldKey, old] of batches) {
        if (old.slots.every((slot) => slot.status !== 'pending')) {
          batches.delete(oldKey)
          break
        }
      }
    }
    batch = newBatch(key, count)
    batches.set(key, batch)
    hydrateBatch(req, batch)
  }

  // A running batch already owns the queue. Joining it — from a rerender, a stored replay,
  // or a second turn with the same request — never starts a second runner.
  if (batch.running) return batch

  if (!dispatch) {
    // Display only: everything stored is on screen, the rest is a hole the user can fill.
    let changed = false
    for (const slot of batch.slots) {
      if (slot.status === 'pending') {
        slot.status = 'missing'
        changed = true
      }
    }
    if (changed) emit(batch)
    return batch
  }

  // Explicit permission (a live turn, or that turn's retry button) fills the holes. A
  // failed slot is left alone: it has its own error and re-running it on every rerender is
  // exactly the loop this file exists to prevent.
  for (const slot of batch.slots) {
    if (slot.status === 'missing') slot.status = 'pending'
  }

  if (batch.slots.every((slot) => slot.status !== 'pending')) return batch

  batch.started = true
  batch.running = true
  void run(batch, req)

  return batch
}

/** The single slot loop: one ComfyUI job at a time, results published per frame. */
async function run(batch: Batch, req: BatchRequest) {
  try {
    for (const slot of batch.slots) {
      if (slot.status !== 'pending') continue
      try {
        // One job at a time: the whole point is a single GPU with one queue. The per-slot
        // key means a rerender or a reload never asks for a frame twice.
        const rendered = await cachedRender(slotKey(req, slot.index), () =>
          withRetry(() => postFrame(req)),
        )
        slot.status = 'done'
        slot.url = rendered.url
        slot.file = rendered.file
        slot.seed = rendered.seed
      } catch (e) {
        // Keep everything already on screen; this slot reports its own failure.
        slot.status = 'error'
        slot.error = String(e)
      }
      emit(batch)
    }
    // Record the finished set under the aggregate key as well, so the next replay of this
    // turn finds one entry with every frame — the shape the one-job batch used to write.
    if (batch.slots.every((slot) => slot.status === 'done')) {
      rememberImage(batch.key, {
        url: batch.slots[0]?.url ?? '',
        prompt: String(req.prompt ?? ''),
        lane: String(req.lane ?? 'real'),
        quality: typeof req.quality === 'string' ? req.quality : undefined,
        seed: batch.slots[0]?.seed ?? 0,
        steps: 0,
        file: batch.slots[0]?.file ?? '',
        images: batch.slots.map((slot) => ({ url: slot.url ?? '', file: slot.file })),
      })
    }
  } finally {
    batch.running = false
  }
}

/**
 * Fill slots from what is already stored, without touching the network: the aggregate
 * entry an older build wrote (`images` in request order), then this build's per-slot
 * entries, in either quality lane.
 */
function hydrateBatch(req: BatchRequest, batch: Batch) {
  const aggregate = recordedImage(req)?.images ?? []
  for (const slot of batch.slots) {
    if (slot.status !== 'pending') continue
    const stored =
      peek(slotKey(req, slot.index)) ??
      peek(slotKey({ ...req, count: 1, quality: otherLane(req.quality) }, slot.index))
    const source = stored ?? aggregate[slot.index]
    if (!source || !source.url) continue
    slot.status = 'done'
    slot.url = source.url
    slot.file = source.file
    slot.seed = stored?.seed ?? slot.seed
  }
  if (batch.slots.some((slot) => slot.status === 'done')) emit(batch)
}

function otherLane(quality: unknown): string {
  return quality === 'high' ? 'fast' : 'high'
}
