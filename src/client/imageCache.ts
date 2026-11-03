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
 * `quality`, `count` and the edit `source` do change the picture, so they are part of the
 * key: a fast render must not answer a request for a high-quality one, and an edit of
 * another file must not replay this one. The dispatcher always writes the enforced
 * quality into the args first (`withSelectedQuality`), so the key agrees with the graph
 * Rust actually queues.
 */
export function imageKey(args: Record<string, unknown>): string {
  const norm = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : v);
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
  ]);
}

/**
 * The key is a positional array, so adding `quality`, `count` and `source` silently orphaned
 * every render stored by an older build: the same request hashed to a new key, missed, and
 * was regenerated on the next launch. Rewrite the 7-field shape under the current key. Those
 * entries predate the quality picker, so they were all fast/single with no edit source.
 */
export function migrateKey(key: string): string | null {
  let parts: unknown;
  try {
    parts = JSON.parse(key);
  } catch {
    return null;
  }
  if (!Array.isArray(parts) || parts.length !== 7) return null;
  const [lane, prompt, width, height, steps, cfg, negative] = parts;
  return imageKey({ lane, prompt, width, height, steps, cfg, negative });
}

let db: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (db) return db;
  db = new Promise((resolve) => {
    try {
      const req = indexedDB.open("minx-images", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("images")) {
          req.result.createObjectStore("images");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return db;
}

export async function hydrate(): Promise<void> {
  const conn = await open();
  if (!conn) return;
  await new Promise<void>((resolve) => {
    // Readwrite so an old-shape key can be re-keyed in place, keeping its image.
    const tx = conn.transaction("images", "readwrite");
    const store = tx.objectStore("images");
    const req = store.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
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
}

export function persistImage(key: string, value: Rendered) {
  void open().then((conn) => {
    if (!conn) return;
    try {
      conn.transaction("images", "readwrite").objectStore("images").put(value, key);
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
 * The only way the app should render: memory hit, else a shared in-flight render, else
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
