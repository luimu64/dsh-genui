import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { defineComponent } from "@openuidev/react-lang";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import { registerComponents } from "./components";
import { batchColumns, currentFrameSource, type FrameSlot } from "./frames";
import { ImagePlaceholder } from "./pending";
import { useReplay } from "./replay";
import { z } from "zod/v4";

/** A file name a browser download can offer. */
function safeName(prompt: string) {
  return (
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "image"
  );
}

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.click();
}

/** One line of the host's own failure text, for the cell under a failed frame. */
function shortError(error: string): string {
  const text = error.replace(/^Error:\s*/, "").replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

function downloadName(prompt: string, suffix = "") {
  return `${safeName(prompt)}${suffix}-${new Date().toISOString().slice(0, 10)}.png`;
}

/** One picture the viewer can step through. */
type ViewerFrame = { url: string; prompt: string };

/**
 * The fullscreen viewer is plain DOM, not React state. These components re-render on every
 * streamed chunk of the answer, and a state-held overlay was torn down and rebuilt on each
 * one - which is what flickered. A detached overlay opened once, outside React, survives
 * re-renders.
 *
 * Two more things flickered and are handled here:
 *  - the overlay used to be attached before the picture was decoded, so one frame showed an
 *    empty black scrim. `img.decode()` now completes first and the layer is attached with a
 *    painted image in it;
 *  - closing toggled `document.body.style.overflow`, which removed the scrollbar and reflowed
 *    the thread underneath. Nothing scrolls the page here (the app shell is 100% and the
 *    thread has its own scroller), so the lock is simply gone and there is no reflow to see.
 */
let viewer: HTMLDivElement | null = null;
let viewerUrl = "";
let viewerReturnFocus: HTMLElement | null = null;
/**
 * The frames the open viewer can step through, behind a getter rather than an array: a
 * batch that is still rendering gains its remaining pictures while the viewer stays open,
 * and the set is read again on every step, so navigation never walks a stale list.
 */
let viewerFrames: () => ViewerFrame[] = () => [];
let viewerPaint: ((index: number) => void) | null = null;

function stepViewer(delta: number) {
  if (!viewerPaint) return;
  const frames = viewerFrames();
  if (frames.length < 2) return;
  // Found by url, not remembered as an index: a batch fills in out of order, so the same
  // index can mean a different picture a second later.
  const at = frames.findIndex((frame) => frame.url === viewerUrl);
  const from = at < 0 ? 0 : at;
  viewerPaint((from + delta + frames.length) % frames.length);
}

/**
 * Repaint the open viewer from its frame list. A batch that is still rendering adds its
 * remaining pictures underneath an open viewer, and the counter and arrows have to keep up
 * without the picture being reopened.
 */
function refreshViewer() {
  if (!viewer || !viewerPaint) return;
  const at = viewerFrames().findIndex((frame) => frame.url === viewerUrl);
  if (at >= 0) viewerPaint(at);
}

function onViewerKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    closeViewer();
    return;
  }
  // A batch is one viewer: the arrows walk it instead of going back to the grid.
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    stepViewer(-1);
    return;
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    stepViewer(1);
  }
}

function closeViewer() {
  const overlay = viewer;
  if (!overlay) return;
  viewer = null;
  viewerUrl = "";
  viewerFrames = () => [];
  viewerPaint = null;
  window.removeEventListener("keydown", onViewerKey);
  // Removed immediately: there is no exit animation to wait for, and a held
  // dark layer over a still-visible page is exactly the kind of half-faded
  // frame this viewer used to flash.
  overlay.remove();
  const back = viewerReturnFocus;
  viewerReturnFocus = null;
  if (back && back.isConnected) back.focus({ preventScroll: true });
}

async function viewFullSize(
  url: string,
  prompt: string,
  frames?: () => ViewerFrame[],
  action?: (frame: ViewerFrame) => { label: string; run: () => void },
) {
  // Clicking a picture of the set that is already open steps to it: a second click on the
  // same picture (or on the fullscreen button while it is open) must not rebuild the layer,
  // because teardown + rebuild in one frame is exactly the flash.
  if (viewer) {
    const open = frames ? frames() : [];
    const at = open.findIndex((frame) => frame.url === url);
    if (at >= 0) {
      viewerPaint?.(at);
      return;
    }
    if (viewerUrl === url) return;
  }
  closeViewer();

  const overlay = document.createElement("div");
  overlay.className = "genimg-overlay";
  // The viewer is appended to <body>, outside .genui-root: this attribute is what scopes
  // its rules to it.
  overlay.dataset.genuiOverlay = "";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", prompt);

  const img = document.createElement("img");
  img.decoding = "sync";

  const bar = document.createElement("div");
  bar.className = "genimg-overlay-bar";
  const label = document.createElement("span");
  label.className = "genimg-overlay-prompt";
  const counter = document.createElement("span");
  counter.className = "genimg-overlay-count";

  const step = (delta: number, text: string, name: string) => {
    const button = document.createElement("button");
    button.className = "genimg-overlay-step";
    button.textContent = text;
    button.title = name;
    button.setAttribute("aria-label", name);
    button.addEventListener("click", () => stepViewer(delta));
    return button;
  };
  const prev = step(-1, "‹", "Previous image");
  const next = step(1, "›", "Next image");

  const save = document.createElement("button");
  save.className = "genimg-overlay-save";
  save.hidden = !action;

  const close = document.createElement("button");
  close.textContent = "Close";
  close.setAttribute("aria-label", "Close full size view");
  close.addEventListener("click", closeViewer);

  bar.append(label, counter, prev, next, save, close);

  /** Put frame `index` on screen. Everything on the bar follows the picture, not the click. */
  const paint = (index: number) => {
    const framesNow = viewerFrames();
    const frame = framesNow[index];
    if (!frame) return;
    viewerUrl = frame.url;
    img.src = frame.url;
    img.alt = frame.prompt;
    label.textContent = frame.prompt;
    overlay.setAttribute("aria-label", frame.prompt);
    // One picture is not a set: no arrows, no "1 / 1".
    const many = framesNow.length > 1;
    counter.hidden = !many;
    prev.hidden = !many;
    next.hidden = !many;
    counter.textContent = many ? `${index + 1} / ${framesNow.length}` : "";
    const bound = action?.(frame);
    if (bound) {
      save.textContent = bound.label;
      save.onclick = bound.run;
    }
  };

  viewerFrames = frames ?? (() => [{ url, prompt }]);
  viewerPaint = paint;
  paint(Math.max(0, viewerFrames().findIndex((frame) => frame.url === url)));

  for (const el of [img, bar]) el.addEventListener("click", (e) => e.stopPropagation());
  overlay.append(img, bar);
  overlay.addEventListener("click", closeViewer);

  // Wait for the bitmap, but never let a decode failure keep the viewer shut.
  try {
    await img.decode();
  } catch {
    /* decode() rejects on an already-loaded or odd image; the element still paints */
  }

  viewerReturnFocus = (document.activeElement as HTMLElement | null) ?? null;
  window.addEventListener("keydown", onViewerKey);
  document.body.append(overlay);
  viewer = overlay;
  close.focus({ preventScroll: true });
}

/**
 * The one card a generated picture is shown in: a full-width frame, the two
 * hover actions (open full size, download the exact PNG) and a caption.
 *
 * Every component that can carry a render goes through it, including the
 * library's own `ImageBlock` / `Image` / `ImageGallery`, which are overridden
 * below. A high-quality render used to arrive as `ImageBlock(src, alt)` and was
 * painted by that component's gallery layout: a wide blurred box with the tall
 * 992x1504 picture contained inside it as a small strip, no click-to-open and
 * no download. The quality picker was irrelevant to it — the emitted component
 * name was — so the fix is the renderer, not the prompt.
 */
function GenFigure({
  src,
  caption,
  prompt,
  showCaption = true,
  tile = false,
  frames,
  onAspect,
}: {
  src: string;
  caption: string;
  prompt: string;
  showCaption?: boolean;
  /** Fill a fixed box owned by the grid cell instead of sizing to the picture. */
  tile?: boolean;
  /** The set this picture belongs to, so the full size view can walk it. */
  frames?: () => ViewerFrame[];
  /** Told the picture's own width/height ratio once the bitmap is here. */
  onAspect?: (ratio: number) => void;
}) {
  const [note, setNote] = useState("");

  const save = useCallback(async () => {
    const name = downloadName(prompt);
    setNote("saving…");
    try {
      await download(src, name);
      setNote(`saved ${name}`);
    } catch (e) {
      setNote(String(e));
    }
  }, [src, prompt]);

  // The viewer's download button is bound per frame: stepping to another picture of the set
  // must offer that picture, not the one the viewer was opened on.
  const open = (frameSrc: string, frameCaption: string) =>
    viewFullSize(frameSrc, frameCaption, frames, (frame) => ({
      label: "Download",
      run: () => void download(frame.url, downloadName(frame.prompt)),
    }));

  const frame = (
    <div className={tile ? "genimg-frame is-tile" : "genimg-frame"}>
      <img
        src={src}
        alt={caption}
        onClick={() => open(src, caption)}
        title="Click to view full size"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            onAspect?.(img.naturalWidth / img.naturalHeight);
          }
        }}
      />
      <div className="genimg-actions">
        <button
          onClick={() => open(src, caption)}
          title="View full size"
          aria-label="View full size"
        >
          ⤢
        </button>
        <button onClick={() => void save()} title="Download PNG" aria-label="Download PNG">
          ↓
        </button>
      </div>
    </div>
  );

  if (!showCaption) return frame;

  return (
    <figure className="genimg">
      {frame}
      <figcaption>
        <span>{caption}</span>
        {note ? <span className="genimg-note">{note}</span> : null}
      </figcaption>
    </figure>
  );
}

/**
 * A picture a stored answer refers to that has no render this page can show: it was never
 * copied in, the cache was rebuilt, or that frame of a batch never finished. It is painted
 * as a hole with an explicit control, never as progress — a shimmer that never ends reads
 * as "still rendering", and a silent re-render spends the GPU on a conversation the user
 * only opened.
 *
 * Reaching this state takes a settled query: see `useSettled`.
 */
function MissingFrame({
  height,
  onRetry,
  label,
}: {
  height: number | string;
  onRetry: () => void;
  label?: string;
}) {
  return (
    <div
      className="genimg-loading is-missing"
      style={{ height, gap: 8 }}
      role="status"
      aria-label={label ?? "image not available"}
    >
      <span>{label ?? "this picture is not saved on this machine"}</span>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        render it again
      </Button>
    </div>
  );
}

/**
 * False only for the first moments of a mount. A stored answer's query answers
 * asynchronously — it first waits for the cache to hydrate — so the first paint of every
 * image component is an empty result even when the picture is sitting in the cache. Painting
 * the terminal "not saved" box on that first paint is what made a rendering frame look
 * broken; the box waits for the query to have had its moment.
 */
function useSettled(delay = 400): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  return settled;
}

const GenImage = defineComponent({
  name: "GenImage",
  description:
    "One picture at an image URL, with a full-size viewer and a download action.",
  props: z.object({
    url: z.string(),
    prompt: z.string(),
    seed: z.number().optional(),
  }),
  component: ({ props }) => {
    const { mayGenerate, retry } = useReplay();
    const settled = useSettled();
    if (!props.url) {
      // An empty url is "being made right now", "about to be asked for", or "gone". Only
      // the first two may claim progress, and the second is indistinguishable from the
      // third until the query has had a moment to answer: after a reload the newest answer
      // dispatches even though it is not `live`, and calling that "not saved on this
      // machine" put a terminal message next to a frame that was rendering.
      if (mayGenerate() || !settled) {
        return <ImagePlaceholder height={320}>rendering…</ImagePlaceholder>;
      }
      return <MissingFrame height={320} onRetry={retry} />;
    }

    return <GenFigure src={props.url} caption={props.prompt} prompt={props.prompt} />;
  },
});

/** One cell of a set: the renderer's own vocabulary, filled in by a frame source. */
type SlotView = FrameSlot & { url: string };

const noSubscribe = () => () => {};
const noVersion = () => 0;

/**
 * One entry per requested image, finished or not, in request order.
 *
 * While a batch is filling, the slots come from the frame source the image bundle registered
 * and this component subscribes to it, so each picture appears the moment that image is done -
 * without re-parsing the answer or re-running its query for every frame. With no image bundle
 * installed nothing is registered, and a set is simply the urls the program carries: a
 * picture at a URL still paints, an empty entry is a frame that was never rendered, and the
 * hole stays in the right cell instead of silently shortening the grid.
 */
function useBatchSlots(urls: unknown): SlotView[] {
  const source = currentFrameSource();
  const key = source?.keyOf(urls) ?? null;
  const live = source && key ? source.slots(key) : null;
  useSyncExternalStore(
    source && key ? (listener) => source.subscribe(key, listener) : noSubscribe,
    source && key ? () => source.version(key) : noVersion,
    source && key ? () => source.version(key) : noVersion,
  );
  if (live) {
    return live.map((slot) => ({
      url: slot.url ?? "",
      error: slot.error,
      missing: slot.missing,
      prompt: slot.prompt,
    }));
  }
  const list = Array.isArray(urls) ? urls : [];
  return list.map((entry) => {
    const url =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object" && typeof (entry as { url?: unknown }).url === "string"
          ? ((entry as { url: string }).url ?? "")
          : "";
    return { url, missing: !url };
  });
}

const GenImageSet = defineComponent({
  name: "GenImageSet",
  description:
    "Several pictures as one grid; each opens in the same viewer.",
  props: z.object({
    // A query that renders a set returns `images` as [{url, file}]; older stored answers carry plain
    // strings. Both shapes are accepted and normalised, so neither has to be rewritten.
    //
    // A frame of a batch still in flight may also carry `batch`/`index`/`total`. The extra
    // fields are schema-declared so the renderer does not strip them.
    urls: z.array(
      z.union([
        z.string(),
        z.object({
          url: z.string().optional(),
          file: z.string().optional(),
          batch: z.string().optional(),
          index: z.number().optional(),
          total: z.number().optional(),
        }),
      ]),
    ),
    prompt: z.string(),
    quality: z.string().optional(),
  }),
  component: ({ props }) => {
    const [note, setNote] = useState("");
    const { mayGenerate, retry } = useReplay();
    const settled = useSettled();
    const slots = useBatchSlots(props.urls);
    // The shape of the set, taken from the first picture that lands. Until then the grid is
    // laid out in the default portrait box; a lane that renders landscape or square corrects
    // it once, before anything has painted over the placeholders.
    const [aspect, setAspect] = useState<number | null>(null);
    const done = slots.filter((slot) => slot.url);
    const failed = slots.filter((slot) => !slot.url && slot.error);
    const gone = slots.filter((slot) => !slot.url && slot.missing);

    // The frames the full size view walks. Held in a ref and read through a getter so a
    // picture that lands while the viewer is open joins the walk without closing it.
    const liveSlots = useRef(slots);
    useEffect(() => {
      liveSlots.current = slots;
      // A frame that landed while the full size view is open joins the walk, and the
      // counter beside the picture moves with it.
      refreshViewer();
    }, [slots]);
    const frames = useCallback(
      () =>
        liveSlots.current.flatMap((slot, i) =>
          slot.url
            ? [{ url: slot.url, prompt: slot.prompt ?? `${props.prompt} (${i + 1})` }]
            : [],
        ),
      [props.prompt],
    );

    const save = useCallback(async () => {
      setNote("saving…");
      try {
        for (let i = 0; i < done.length; i++) {
          await download(done[i].url, downloadName(props.prompt, `-${i + 1}`));
        }
        setNote(`saved ${done.length}`);
      } catch (e) {
        setNote(String(e));
      }
    }, [done, props.prompt]);

    if (!slots.length) {
      // Nothing to paint yet. A stored answer whose set is gone is a hole, not a shimmer
      // that runs forever — but only once the query has answered, because the newest stored
      // answer does dispatch and its frames are on their way.
      if (mayGenerate() || !settled) {
        return <ImagePlaceholder height={240}>rendering the set…</ImagePlaceholder>;
      }
      return <MissingFrame height={240} onRetry={retry} label="no frames of this set are saved on this machine" />;
    }

    return (
      <figure className="genimg">
        <div
          className="genimg-grid"
          style={{
            // Sized from the request, not from how many frames have landed, so the
            // placeholders do not reflow the page as each picture arrives.
            gridTemplateColumns: `repeat(${batchColumns(slots.length)}, minmax(0, 1fr))`,
          }}
        >
          {slots.map((slot, i) => (
            // Every cell is a fixed box whether it holds a shimmer, a failure, a hole or a
            // finished picture. The frame that arrives is *contained* in the box it was
            // promised, so a batch fills in without moving anything below it.
            <div
              className="genimg-cell"
              key={i}
              style={aspect ? { aspectRatio: String(aspect) } : undefined}
            >
              {slot.url ? (
                // Each finished frame is complete on its own: full-size view and download
                // work while the rest of the set is still rendering.
                <GenFigure
                  src={slot.url}
                  // Each frame names the prompt it was rendered with: a batch may list a
                  // different one per picture.
                  caption={slot.prompt ?? `${props.prompt} (${i + 1})`}
                  prompt={slot.prompt ?? `${props.prompt} (${i + 1})`}
                  showCaption={false}
                  tile
                  frames={frames}
                  onAspect={(ratio) => setAspect((current) => current ?? ratio)}
                />
              ) : slot.missing ? (
                <MissingFrame
                  height="100%"
                  onRetry={retry}
                  label={`frame ${i + 1} was never rendered`}
                />
              ) : slot.error ? (
                <div
                  className="genimg-loading is-failed"
                  style={{ height: "100%" }}
                  role="status"
                  title={slot.error}
                  aria-label={`image ${i + 1} failed`}
                >
                  could not render this picture
                  {/* The host's own words, not ours: a rejected frame and a backend that is down
                      look identical as "failed" and send the reader somewhere different. */}
                  <span className="genimg-note">{shortError(slot.error)}</span>
                </div>
              ) : (
                // A batch is not its query: the query resolved with slots, and each frame
                // reports through its own status. Never paint the whole grid broken.
                <ImagePlaceholder height="100%" failed={false}>
                  rendering…
                </ImagePlaceholder>
              )}
            </div>
          ))}
        </div>
        <figcaption>
          <span>
            {props.prompt}
            {props.quality ? ` · ${props.quality}` : ""} · {done.length} of {slots.length}{" "}
            {slots.length === 1 ? "image" : "images"}
            {failed.length ? ` · ${failed.length} failed` : ""}
            {gone.length ? ` · ${gone.length} never rendered` : ""}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void save()} disabled={!done.length}>
            download all
          </Button>
          {note ? <span className="genimg-note">{note}</span> : null}
        </figcaption>
      </figure>
    );
  },
});

/**
 * The library's own image components, re-pointed at the renderer above. Their
 * schemas are unchanged, so a stored answer written against `ImageBlock(src,
 * alt)` keeps parsing, and the prompt the model sees still offers the same
 * names — only the painted result changes. `override` re-points every parent
 * union at these definitions, which is why this is a library fix and not a
 * prompt rule.
 */
const ImageBlockCard = defineComponent({
  name: "ImageBlock",
  description: "Generated image, shown full size with a viewer and a download action.",
  props: z.object({ src: z.string(), alt: z.string().optional() }),
  component: ({ props }) => {
    if (!props.src) {
      return <ImagePlaceholder height={320}>rendering…</ImagePlaceholder>;
    }
    const caption = props.alt ?? "Generated image";
    return <GenFigure src={props.src} caption={caption} prompt={caption} />;
  },
});

const ImageCard = defineComponent({
  name: "Image",
  description: "Generated image, shown full size with a viewer and a download action.",
  props: z.object({ alt: z.string(), src: z.string().optional() }),
  component: ({ props }) => {
    if (!props.src) return null;
    return <GenFigure src={props.src} caption={props.alt} prompt={props.alt} />;
  },
});

const ImageGalleryCards = defineComponent({
  name: "ImageGallery",
  description: "Generated images as a grid, each with a viewer and a download action.",
  props: z.object({
    images: z.array(
      z.object({
        src: z.string(),
        alt: z.string().optional(),
        details: z.string().optional(),
      }),
    ),
  }),
  component: ({ props }) => {
    const list = props.images.filter((img) => img.src);
    if (!list.length) {
      return <ImagePlaceholder height={240}>rendering…</ImagePlaceholder>;
    }
    const captionOf = (img: { src: string; alt?: string; details?: string }, i: number) =>
      img.alt ?? img.details ?? `Generated image ${i + 1}`;
    const frames = () =>
      list.map((img, i) => ({ url: img.src, prompt: captionOf(img, i) }));
    return (
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: `repeat(${list.length > 1 ? 2 : 1}, minmax(0, 1fr))`,
        }}
      >
        {list.map((img, i) => {
          const caption = captionOf(img, i);
          return (
            <GenFigure
              key={i}
              src={img.src}
              caption={caption}
              prompt={caption}
              frames={frames}
            />
          );
        })}
      </div>
    );
  },
});

/**
 * This bundle's own components, registered through the same path a companion uses: two new
 * components that join "Card.children", and three shipped ones re-pointed at the frame above.
 * The prompt lines for these five are in "assets/prompt-core.txt" — they are the catalogue every
 * deployment gets, which is the one thing a companion's components do not have.
 */
export const builtinComponents = [
  { component: GenImage, slots: ["Card.children"] },
  { component: GenImageSet, slots: ["Card.children"] },
  { component: ImageBlockCard, override: true },
  { component: ImageCard, override: true },
  { component: ImageGalleryCards, override: true },
];

registerComponents(builtinComponents);
