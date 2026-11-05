import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { defineComponent } from "@openuidev/react-lang";
import { openuiLibrary } from "@openuidev/react-ui";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import { DEFAULT_WORKFLOWS, QUALITY_IDS } from "../shared/models";
import { batchSlots, batchVersion, subscribeBatch } from "./batches";
import { imageUrls } from "./images";
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
}: {
  src: string;
  caption: string;
  prompt: string;
  showCaption?: boolean;
  /** Fill a fixed box owned by the grid cell instead of sizing to the picture. */
  tile?: boolean;
  /** The set this picture belongs to, so the full size view can walk it. */
  frames?: () => ViewerFrame[];
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
 * A picture a stored answer refers to that is not on this machine any more: the file was
 * never copied in, the cache was rebuilt, or that frame of a batch never finished. It is
 * painted as a hole with an explicit control, never as progress — a shimmer that never
 * ends reads as "still rendering", and a silent re-render spends the GPU on a conversation
 * the user only opened.
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

const GenImage = defineComponent({
  name: "GenImage",
  description:
    "Shows the image produced by the generate_image query. Pass query.url and query.prompt.",
  props: z.object({
    url: z.string(),
    prompt: z.string(),
    seed: z.number().optional(),
  }),
  component: ({ props }) => {
    const { allowGeneration, retry } = useReplay();
    if (!props.url) {
      // An empty url is either "being made right now" or "gone"; only the turn that may
      // queue work is allowed to claim the first.
      if (!allowGeneration) {
        return <MissingFrame height={320} onRetry={retry} />;
      }
      return <ImagePlaceholder height={320}>rendering…</ImagePlaceholder>;
    }

    return <GenFigure src={props.url} caption={props.prompt} prompt={props.prompt} />;
  },
});

type SlotView = { url: string; error?: string; missing?: boolean; prompt?: string };

/** The batch a set of urls belongs to, when it was queued frame by frame. */
function batchOf(urls: unknown): string | null {
  const first = Array.isArray(urls) ? urls[0] : null;
  if (!first || typeof first !== "object") return null;
  const key = (first as { batch?: unknown }).batch;
  return typeof key === "string" ? key : null;
}

const noSubscribe = () => () => {};
const noVersion = () => 0;

/**
 * One entry per requested image, finished or not, in request order.
 *
 * A running batch reads its slots from the batch store and subscribes to it, so each
 * picture appears the moment that image is done — without re-parsing the answer or
 * re-running its query for every frame. A set that is not a live batch (a stored answer,
 * or a reply written before progressive rendering) falls back to the urls it carries.
 */
function useBatchSlots(urls: unknown): SlotView[] {
  const key = batchOf(urls);
  useSyncExternalStore(
    key ? (listener) => subscribeBatch(key, listener) : noSubscribe,
    key ? () => batchVersion(key) : noVersion,
    key ? () => batchVersion(key) : noVersion,
  );
  const live = key ? batchSlots(key) : null;
  if (live) {
    return live.map((slot) => ({
      url: slot.url ?? "",
      error: slot.error,
      missing: slot.status === "missing",
      prompt: slot.prompt,
    }));
  }
  return imageUrls(urls).map((url) => ({ url }));
}

const GenImageSet = defineComponent({
  name: "GenImageSet",
  description:
    "Shows every image of a batched generate_image query as a grid. Pass query.images and query.prompt.",
  props: z.object({
    // `generate_image` returns `images` as [{url, file}]; older stored answers carry plain
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
    const { allowGeneration, retry } = useReplay();
    const slots = useBatchSlots(props.urls);
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
      // Nothing to paint and nothing coming: a stored answer whose set is gone is a hole,
      // not a shimmer that runs forever.
      if (!allowGeneration) {
        return <MissingFrame height={240} onRetry={retry} label="this set is not saved on this machine" />;
      }
      return <ImagePlaceholder height={240}>rendering the set…</ImagePlaceholder>;
    }

    return (
      <figure className="genimg">
        <div
          className="genimg-grid"
          style={{
            // Sized from the request, not from how many frames have landed, so the
            // placeholders do not reflow the page as each picture arrives.
            gridTemplateColumns: `repeat(${slots.length > 1 ? 2 : 1}, minmax(0, 1fr))`,
          }}
        >
          {slots.map((slot, i) => (
            // Every cell is a fixed box whether it holds a shimmer, a failure, a hole or a
            // finished picture. The frame that arrives is *contained* in the box it was
            // promised, so a batch fills in without moving anything below it.
            <div className="genimg-cell" key={i}>
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
                />
              ) : slot.missing ? (
                <MissingFrame
                  height="100%"
                  onRetry={retry}
                  label={`image ${i + 1} is not saved on this machine`}
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
            {gone.length ? ` · ${gone.length} not saved here` : ""}
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

export const genuiLibrary = openuiLibrary.extend!({
  components: {
    add: [
      { component: GenImage, slots: ["Card.children"] },
      { component: GenImageSet, slots: ["Card.children"] },
    ],
    override: [ImageBlockCard, ImageCard, ImageGalleryCards],
  },
});

/**
 * The two side effects the model may request. Declaring them here is what teaches the
 * generated prompt the `Query("generate_image", ...)` syntax - without it the model invents
 * a `generate_image(...)` function call that never reaches the host.
 *
 * This is the **default** tool surface: the workflows a fresh install exposes. An opt-in
 * workflow is not described here - a workflow's lane, presets and prompt conventions live in
 * its own prompt section (`assets/prompt-anime.md` is the shipped example), which the host
 * appends only while that workflow is enabled. The enum ids come from `src/shared/models.ts`,
 * the vocabulary both halves share; which workflows exist is the registry's business. See
 * docs/add-workflow.md.
 */
export const genuiPromptOptions = {
  tools: [
    {
      name: "generate_image",
      description:
        "Render images with the local ComfyUI. Use only when the user asks to see, draw, sketch, render or imagine a picture, never to decorate text. Emit at most one per program. Lane \"real\" covers photographs, products, real places and realistic people: one natural-language sentence describing camera, light and lens. quality: \"fast\" (default) is a distilled model tuned for seconds per frame - use it for exploration, chat, and anything the user did not ask to be good. quality: \"high\" swaps in the undistilled checkpoint at its published settings (50 steps at CFG 3, 992x1504) and takes one to four minutes per image plus a cold model load - use it when the user says high quality, best, final, print, or asks for one image they care about. upscale adds a second sampler pass over a latent upscaled by that factor (true = 1.5, up to 2): roughly doubles the time and the file size for real extra detail - use it for wallpaper, print, or when the reader asks for sharper or bigger. count renders 1-8 variations, one after another, so each frame appears in the grid as it lands; use 2-4 for \"options\"/\"variations\"/\"some\", never more than 4 unless asked.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "One natural-language sentence: subject, setting, light, and a lens if it helps. Optional when prompts lists one per picture.",
          },
          lane: {
            type: "string",
            enum: [...DEFAULT_WORKFLOWS],
            description: "Which workflow to drive. Defaults to real.",
          },
          quality: {
            type: "string",
            enum: [...QUALITY_IDS],
            description:
              "fast = distilled lanes, seconds per image (default). high = undistilled checkpoints at published settings, minutes per image.",
          },
          upscale: {
            type: "number",
            description:
              "Hires factor, 1.05-2 (true means 1.5): a second sampler pass over an upscaled latent. Roughly doubles the time for real extra detail. Use for wallpaper, print, or 'sharper'/'bigger'.",
          },
          count: {
            type: "number",
            description:
              "How many images to render, 1-8. Defaults to 1. Frames are queued one at a time and appear as each finishes, so the reader sees the first picture after roughly one render, not after the whole set. Ignored when prompts lists more than one entry.",
          },
          prompts: {
            type: "array",
            description:
              'One prompt per picture, when the frames should differ: "four catgirls, one per city" means prompts: ["catgirl in Tokyo at night", "catgirl in Lagos at noon", ...]. The host varies the seed on its own, so leave this out for the default batch of one prompt rendered at different seeds. Length sets the batch size (1-8); each frame is captioned with its own prompt.',
          },
          steps: {
            type: "number",
            description:
              "Omit for the lane/quality default (real 4 fast / 50 high). Only override to trade speed for detail.",
          },
          nsfw: {
            type: "boolean",
            description:
              "Set true for nude, sexual or explicit requests: the template's content negatives are dropped so the prompt is not overwritten. Always accompany it with adult subject tags.",
          },
          width: { type: "number", description: "Defaults to 832 (992 on the high real lane)." },
          height: { type: "number", description: "Defaults to 1216 (1504 on the high real lane)." },
        },
        // Either prompt or prompts: a batch that lists one prompt per picture has no
        // single prompt to repeat, and requiring one failed the query before it queued.
        required: [],
      },
      outputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL of the first image, a /genui/images path. Pass to GenImage.",
          },
          images: {
            type: "array",
            description: "Every image of the batch as {url, file}. Pass query.images to GenImageSet.",
          },
          file: { type: "string", description: "File name of the first image; pass to edit_image as source." },
          prompt: { type: "string" },
          lane: { type: "string" },
          quality: { type: "string" },
          upscale: { type: "number" },
          seed: { type: "number" },
          steps: { type: "number" },
        },
        required: ["url", "prompt"],
      },
    },
    {
      name: "edit_image",
      description:
        "Change one thing in an image that already exists on disk: the last render, a render from earlier in the conversation, or a file the user names. Runs a reference-conditioned editing model, which repaints the frame from the source, so everything you do not mention is meant to survive. Use it when the user says change, make it, remove, add, recolor, swap or 'same but' about a picture that already exists. One clear instruction per pass; chain passes for several changes. It cannot invent explicit content the source does not already contain - for a new explicit scene use generate_image instead.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "One natural-language instruction, e.g. 'Change her jacket to red leather, keep everything else identical.'",
          },
          source: {
            type: "string",
            description:
              "File name of the image to edit. Omit to edit the newest render in the image directory. Use one of the file names the system prompt lists under 'Renders in this conversation' - that list holds every image of the conversation, newest first.",
          },
        },
        required: ["prompt"],
      },
      outputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL of the edited image. Pass to GenImage." },
          file: { type: "string" },
          prompt: { type: "string" },
          lane: { type: "string" },
          seed: { type: "number" },
        },
        required: ["url", "prompt"],
      },
    },
  ],
  toolExamples: [
    `root = Stack([card])
query = Query("generate_image", {prompt: "a red fox crossing fresh snow at dawn, 200mm, soft overcast light", lane: "real"}, {url: ""})
card = Card([GenImage(query.url, "A red fox in fresh snow")])`,
    `root = Stack([card])
query = Query("generate_image", {prompt: "a baker pulling bread from a stone oven, warm morning light, 35mm", lane: "real", quality: "high"}, {url: ""})
card = Card([GenImage(query.url, "Baker at a stone oven, high quality")])`,
    `root = Stack([card])
query = Query("generate_image", {prompt: "a ceramic teapot on a linen cloth, window light, 50mm macro", lane: "real", count: 4}, {url: "", images: []})
card = Card([GenImageSet(query.images, "Ceramic teapot, four variations")])`,
    `root = Stack([card])
query = Query("edit_image", {prompt: "Change her jacket to red leather, keep everything else identical."}, {url: ""})
card = Card([GenImage(query.url, "Jacket recoloured to red leather")])`,
  ],
};
