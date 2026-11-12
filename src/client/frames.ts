/**
 * Progressive image frames, as a registry instead of a store.
 *
 * `GenImageSet` paints one cell per requested picture and fills them in as they land. How a
 * frame gets made - one job, four jobs, a ComfyUI queue - is the image bundle's business; what
 * the renderer needs is a way to ask "is this list a batch that is still filling, and what is
 * in each slot right now". That is what a `FrameSource` answers, and nothing is registered
 * when no image bundle is installed: the list is then painted as the plain URLs it carries.
 */
export interface FrameSlot {
  url?: string
  /** The host's own words for a frame that failed. */
  error?: string
  /** A frame that was never rendered and never will be without a user asking. */
  missing?: boolean
  /** The prompt this frame was rendered with, when a batch listed one per picture. */
  prompt?: string
}

export interface FrameSource {
  /** The batch key a `GenImageSet` list belongs to, or null when it is not a live batch. */
  keyOf(urls: unknown): string | null
  subscribe(key: string, listener: () => void): () => void
  version(key: string): number
  /** The live slots of that batch, or null when the batch is unknown to this source. */
  slots(key: string): FrameSlot[] | null
}

let source: FrameSource | null = null

export function registerFrameSource(next: FrameSource): () => void {
  source = next
  return () => {
    if (source === next) source = null
  }
}

export function currentFrameSource(): FrameSource | null {
  return source
}

/**
 * How many columns a set of `count` frames is painted in. Two was hard-coded and is only
 * right for four pictures: five frames became 2 + 2 + a half-width orphan, which reads as a
 * broken layout rather than a set. Three across for the awkward counts keeps every row but the
 * last full, and eight (the batch ceiling) stays a square sheet.
 */
export function batchColumns(count: number): number {
  if (count <= 1) return 1
  if (count === 2) return 2
  if (count === 3) return 3
  if (count === 4) return 2
  if (count <= 6) return 3
  return 4
}
