/**
 * What has already been rendered, keyed the way the browser keys it.
 *
 * The client's cache is IndexedDB, which belongs to one browser profile on one origin: clear
 * it, open the harness from another host name, or lose the tab's storage, and every stored
 * answer replays into a "not saved on this machine" box — while the PNG sits in `imagesDir`
 * the whole time. That message was a lie about a file that exists.
 *
 * So the host keeps the mapping too. The browser sends the key it hashed for a request, the
 * host records `key -> render` beside the pictures, and a cache miss can ask for it back.
 * The file is the truth; the browser cache is only a fast path.
 */
import { readFileSync, renameSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** The wire shape of a saved render. Mirrors `GenResult`, plus the batch's frames. */
export interface IndexedRender {
  url: string
  file: string
  prompt: string
  lane: string
  quality: string
  preset?: string
  upscale?: number
  seed: number
  steps: number
  images: { url: string; file?: string; seed?: number; prompt?: string }[]
}

type IndexFile = Record<string, IndexedRender>

/** Enough for a long conversation; old entries fall out first. */
const MAX_ENTRIES = 512

/**
 * A key is the browser's own JSON array, so it is long but bounded. Rejecting anything else
 * keeps the index file free of objects a caller could grow without limit.
 */
export function safeKey(key: unknown): string | null {
  if (typeof key !== 'string') return null
  const value = key.trim()
  if (!value || value.length > 4096) return null
  return value
}

export interface RenderIndex {
  /** Record a render under the key the browser sent with the request. */
  remember(key: string, render: IndexedRender): void
  /** What was rendered for this key, if this machine made it. */
  lookup(key: string): IndexedRender | undefined
  /** Read-through cache size, for tests and health. */
  size(): number
}

export function createRenderIndex(dir: string): RenderIndex {
  const file = join(dir, 'index.json')
  let entries: IndexFile | null = null

  const load = (): IndexFile => {
    if (entries) return entries
    entries = {}
    try {
      if (!existsSync(file)) return entries
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (!value || typeof value !== 'object') continue
          const render = value as IndexedRender
          if (typeof render.url !== 'string' || !render.url) continue
          entries[key] = {
            ...render,
            images: Array.isArray(render.images)
              ? render.images.filter((image) => image && typeof image.url === 'string')
              : [],
          }
        }
      }
    } catch {
      // A corrupt index is not fatal: the pictures are still on disk, and the next render
      // rewrites the file. Losing the map only costs a re-render, never a file.
      entries = {}
    }
    return entries
  }

  const flush = (map: IndexFile) => {
    try {
      mkdirSync(dir, { recursive: true })
      const temp = `${file}.${process.pid}.tmp`
      writeFileSync(temp, JSON.stringify(map, null, 0))
      renameSync(temp, file)
    } catch {
      // An unwritable index is not a failed render; the client cache still has the entry.
    }
  }

  return {
    remember(key, render) {
      const map = load()
      // Re-inserting moves the key to the end, which is the order a purge follows.
      delete map[key]
      map[key] = { ...render, images: render.images ?? [] }
      const keys = Object.keys(map)
      for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete map[stale]
      flush(map)
    },
    lookup(key) {
      return load()[key]
    },
    size() {
      return Object.keys(load()).length
    },
  }
}
