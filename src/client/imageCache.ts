/**
 * Renders are expensive and a saved conversation replays its `Query()` every time the
 * chat is reopened. Keyed by the request that produced them, so a replay hits this store
 * instead of ComfyUI. In-memory for the session, mirrored to IndexedDB so images survive
 * a restart (localStorage would blow its ~5MB quota on a handful of PNGs).
 */

export type Rendered = {
  url: string;
  prompt: string;
  lane: string;
  quality?: string;
  /** Which full anime checkpoint rendered it, when the query asked for a preset. */
  preset?: string;
  /** The hires factor, present only when the refine pass ran. */
  upscale?: number;
  seed: number;
  steps: number;
  /** Local path of the first image; `edit_image` takes it as `source`. */
  file?: string;
  /**
   * Set by a replay of a *stored* turn whose picture is not on this machine any more.
   * It is a hole that only an explicit user action may fill — never a queue entry.
   */
  missing?: boolean;
  /**
   * Every image of a batched render. `GenImageSet` reads it. A batch that is still
   * running also carries `batch`/`index` here so the slot can subscribe to its own
   * completion instead of waiting for the last frame.
   */
  images?: {
    url: string;
    file?: string;
    batch?: string;
    index?: number;
    total?: number;
  }[];
};

const mem = new Map<string, Rendered>();
export const imageCache = mem;

/**
 * Only the fields that change the picture, so cosmetic arg diffs still hit the cache.
 * `quality`, `count`, `preset`, `upscale` and the edit `source` do change the picture, so they
 * are part of the key: a fast render must not answer a request for a high-quality one, a
 * preset is a different checkpoint, a hires card is a different pass, and an edit of another
 * file must not replay this one. The provider keys the arguments it is about to POST, so the
 * key agrees with the graph the host actually queues.
 */
export function imageKey(args: Record<string, unknown>): string {
  const norm = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : v);
  // `upscale: true` and `upscale: 1.5` queue the same graph, so they hash the same.
  const upscale = args.upscale === true ? 1.5 : typeof args.upscale === "number" ? args.upscale : 1;
  return JSON.stringify([
    norm(args.lane) ?? "real",
    norm(args.prompt),
    norm(args.quality) ?? "fast",
    args.count ?? 1,
    args.width ?? 832,
    args.height ?? 1216,
    args.steps ?? null,
    args.cfg ?? null,
    norm(args.negative) ?? null,
    norm(args.source) ?? null,
    norm(args.preset) ?? null,
    upscale,
  ]);
}

/**
 * The key is a positional array, so adding a field silently orphaned every render stored by an
 * older build: the same request hashed to a new key, missed, and was regenerated on the next
 * launch. Two shapes predate the current one and are rewritten in place:
 *
 *  - 7 fields (lane, prompt, width, height, steps, cfg, negative): before the quality picker,
 *    so every entry was fast, single, with no edit source;
 *  - 10 fields (…, quality, count, …, source): before presets and the hires pass, so no preset
 *    and no upscale.
 */
export function migrateKey(key: string): string | null {
  let parts: unknown;
  try {
    parts = JSON.parse(key);
  } catch {
    return null;
  }
  if (!Array.isArray(parts)) return null;
  if (parts.length === 7) {
    const [lane, prompt, width, height, steps, cfg, negative] = parts;
    return imageKey({ lane, prompt, width, height, steps, cfg, negative });
  }
  if (parts.length === 10) {
    const [lane, prompt, quality, count, width, height, steps, cfg, negative, source] = parts;
    return imageKey({ lane, prompt, quality, count, width, height, steps, cfg, negative, source });
  }
  return null;
}

const DB_NAME = "dsh-genui-images";
const STORE = "images";
/**
 * Name a previous build of this plugin used for the same store. Its entries are the right
 * pictures, so they are adopted once on startup instead of costing every stored answer a
 * re-render. The old database is read, never deleted.
 */
const LEGACY_DB_NAME = "minx-images";

let db: Promise<IDBDatabase | null> | null = null;

function openNamed(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function open(): Promise<IDBDatabase | null> {
  if (!db) db = openNamed(DB_NAME);
  return db;
}

/** Read every stored render, re-keying entries written by an older cache-key shape. */
async function loadStore(conn: IDBDatabase): Promise<number> {
  let count = 0;
  await new Promise<void>((resolve) => {
    // Readwrite so an old-shape key can be re-keyed in place, keeping its image.
    const tx = conn.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
      count += 1;
      const key = String(cur.key);
      const value = cur.value as Rendered;
      mem.set(key, value);
      const migrated = migrateKey(key);
      if (migrated && migrated !== key) {
        mem.set(migrated, value);
        store.put(value, migrated);
        cur.delete();
      }
      cur.continue();
    };
    req.onerror = () => resolve();
  });
  return count;
}

/** Copy the legacy store into this one, once, when this store is empty. */
async function adoptLegacy(conn: IDBDatabase): Promise<void> {
  const legacy = await openNamed(LEGACY_DB_NAME);
  if (!legacy) return;
  try {
    await new Promise<void>((resolve) => {
      const req = legacy.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        const key = migrateKey(String(cur.key)) ?? String(cur.key);
        const value = cur.value as Rendered;
        if (!mem.has(key)) {
          mem.set(key, value);
          try {
            conn.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
          } catch {
            // A failed copy only costs a render later.
          }
        }
        cur.continue();
      };
      req.onerror = () => resolve();
    });
  } finally {
    legacy.close();
  }
}

export async function hydrate(): Promise<void> {
  const conn = await open();
  if (!conn) return;
  const seen = await loadStore(conn);
  if (seen === 0) await adoptLegacy(conn);
}

export function persistImage(key: string, value: Rendered) {
  void open().then((conn) => {
    if (!conn) return;
    try {
      conn.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
    } catch {
      // Losing the cache is acceptable; it only costs a re-render later.
    }
  });
}

/** Memory hit only: never waits, never renders. */
export function peek(key: string): Rendered | undefined {
  return mem.get(key);
}

/**
 * The stored render for this request, once IndexedDB has been read — or nothing. Never
 * produces: this is the whole replay gate, because a historical turn must display what is
 * on this machine and must not queue a GPU job for a picture it cannot have.
 */
export async function lookupRender(key: string): Promise<Rendered | undefined> {
  await hydratedOnce();
  return mem.get(key);
}

/** Store a render in memory *and* on disk, for a result that is complete right now. */
export function rememberImage(key: string, value: Rendered) {
  mem.set(key, value);
  persistImage(key, value);
}

/**
 * What is already stored for this request, if anything — for *displaying* a picture the
 * app has, never for deciding whether to make one.
 *
 * `imageKey` hashes the quality lane, and a stored turn can be replayed after the picker
 * moved (or by a build that never recorded the lane). The entry it produced is still the
 * right picture, so the other lane's entry counts as a hit here: a saved conversation
 * shows its own image instead of announcing a hole that is not one.
 */
export function recordedImage(args: Record<string, unknown>): Rendered | undefined {
  const exact = mem.get(imageKey(args));
  if (exact) return exact;
  const other = args.quality === "high" ? "fast" : "high";
  return mem.get(imageKey({ ...args, quality: other }));
}

/**
 * The only way a render should happen: memory hit, else a shared in-flight render, else
 * `produce`. Without the in-flight map every re-render of the same `Query()` fires its own
 * ComfyUI job, which both wastes GPU time and trips over ComfyUI's single-queue error.
 */
const inflight = new Map<string, Promise<Rendered>>();

export async function cachedRender(
  key: string,
  produce: () => Promise<Rendered>,
): Promise<Rendered> {
  const hit = mem.get(key);
  if (hit) return hit;

  const pending = inflight.get(key);
  if (pending) return pending;

  const job = produce().then((rendered) => {
    mem.set(key, rendered);
    persistImage(key, rendered);
    return rendered;
  });
  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

let hydrated: Promise<void> | null = null;

/** Resolves once every persisted render is in the memory map. Renders wait on this. */
export function hydratedOnce(): Promise<void> {
  if (!hydrated) hydrated = hydrate();
  return hydrated;
}
