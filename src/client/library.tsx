import { useCallback, useState } from "react";
import { defineComponent } from "@openuidev/react-lang";
import { openuiLibrary } from "@openuidev/react-ui";
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

function onViewerKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    closeViewer();
  }
}

function closeViewer() {
  const overlay = viewer;
  if (!overlay) return;
  viewer = null;
  viewerUrl = "";
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
  action?: { label: string; run: () => void },
) {
  // A second click on the same picture (or on the fullscreen button while it is open) must
  // not rebuild the layer: teardown + rebuild in one frame is exactly the flash.
  if (viewer && viewerUrl === url) return;
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
  img.alt = prompt;
  img.src = url;
  img.decoding = "sync";

  const bar = document.createElement("div");
  bar.className = "genimg-overlay-bar";
  const label = document.createElement("span");
  label.className = "genimg-overlay-prompt";
  label.textContent = prompt;
  bar.append(label);
  if (action) {
    const button = document.createElement("button");
    button.textContent = action.label;
    button.addEventListener("click", action.run);
    bar.append(button);
  }
  const close = document.createElement("button");
  close.textContent = "Close";
  close.setAttribute("aria-label", "Close full size view");
  bar.append(close);

  for (const el of [img, bar]) el.addEventListener("click", (e) => e.stopPropagation());
  overlay.append(img, bar);
  overlay.addEventListener("click", closeViewer);
  close.addEventListener("click", closeViewer);

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
  viewerUrl = url;
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
}: {
  src: string;
  caption: string;
  prompt: string;
  showCaption?: boolean;
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

  const frame = (
    <div className="genimg-frame">
      <img
        src={src}
        alt={caption}
        onClick={() => viewFullSize(src, caption)}
        data-tip="Click to view full size"
      />
      <div className="genimg-actions">
        <button
          onClick={() => viewFullSize(src, caption, { label: "Download", run: () => void save() })}
          data-tip="View full size"
          aria-label="View full size"
        >
          ⤢
        </button>
        <button onClick={() => void save()} data-tip="Download PNG" aria-label="Download PNG">
          ↓
        </button>
      </div>
    </div>
  );

  if (!showCaption) return frame;

  return (
    <figure className="genimg" style={{ margin: 0, display: "grid", gap: 6 }}>
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
  height: number;
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
      <button type="button" onClick={onRetry}>
        render it again
      </button>
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
      return <ImagePlaceholder height={320}>rendering on mainframe…</ImagePlaceholder>;
    }

    return <GenFigure src={props.url} caption={props.prompt} prompt={props.prompt} />;
  },
});

type SlotView = { url: string; error?: string; missing?: boolean };

const GenImageSet = defineComponent({
  name: "GenImageSet",
  description:
    "Shows every image of a batched generate_image query as a grid. Pass query.images and query.prompt.",
  props: z.object({
    // `generate_image` returns `images` as [{url, file}], but this used to
    // declare a string array: the objects reached the renderer anyway and every
    // card in a batch painted a broken-image box. Accept both shapes and
    // normalise, so stored answers written either way keep working.
    //
    // A batch still in flight also carries `batch`/`index` on each slot: that is how a
    // frame knows where to look for its own completion instead of waiting for the last
    // one. The extra fields are schema-declared so the renderer does not strip them.
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
    // One Comfy job per batch: every frame lands together, so there is no per-slot store
    // to subscribe to. A stored answer carries its URLs; a stored answer whose files are
    // gone carries none, and that is a hole rather than progress.
    const urls = imageUrls(props.urls);
    const slots: SlotView[] = urls.map((url) => ({ url }));
    const done = slots.filter((slot) => slot.url);
    const failed: SlotView[] = [];
    const gone: SlotView[] = [];

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
      return <ImagePlaceholder height={240}>rendering the set on mainframe…</ImagePlaceholder>;
    }

    return (
      <figure className="genimg" style={{ margin: 0, display: "grid", gap: 6 }}>
        <div
          style={{
            display: "grid",
            gap: 8,
            // Sized from the request, not from how many frames have landed, so the
            // placeholders do not reflow the page as each picture arrives.
            gridTemplateColumns: `repeat(${slots.length > 1 ? 2 : 1}, minmax(0, 1fr))`,
          }}
        >
          {slots.map((slot, i) =>
            slot.url ? (
              // Each finished frame is complete on its own: full-size view and download
              // work while the rest of the set is still rendering.
              <GenFigure
                key={i}
                src={slot.url}
                caption={`${props.prompt} (${i + 1})`}
                prompt={`${props.prompt} (${i + 1})`}
                showCaption={false}
              />
            ) : slot.missing ? (
              <MissingFrame
                key={i}
                height={240}
                onRetry={retry}
                label={`image ${i + 1} is not saved on this machine`}
              />
            ) : slot.error ? (
              <div
                key={i}
                className="genimg-loading is-failed"
                style={{ height: 240 }}
                role="status"
                data-tip={slot.error}
                aria-label={`image ${i + 1} failed`}
              >
                could not render this picture
              </div>
            ) : (
              <ImagePlaceholder key={i} height={240}>
                rendering on mainframe…
              </ImagePlaceholder>
            ),
          )}
        </div>
        <figcaption>
          <span>
            {props.prompt}
            {props.quality ? ` · ${props.quality}` : ""} · {done.length} of {slots.length} images
            {failed.length ? ` · ${failed.length} failed` : ""}
            {gone.length ? ` · ${gone.length} not saved here` : ""}
          </span>
          <button onClick={() => void save()} disabled={!done.length}>
            download all
          </button>
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
      return <ImagePlaceholder height={320}>rendering on mainframe…</ImagePlaceholder>;
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
      return <ImagePlaceholder height={240}>rendering on mainframe…</ImagePlaceholder>;
    }
    return (
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: `repeat(${list.length > 1 ? 2 : 1}, minmax(0, 1fr))`,
        }}
      >
        {list.map((img, i) => {
          const caption = img.alt ?? img.details ?? `Generated image ${i + 1}`;
          return <GenFigure key={i} src={img.src} caption={caption} prompt={caption} />;
        })}
      </div>
    );
  },
});

export const harnessLibrary = openuiLibrary.extend!({
  components: {
    add: [
      { component: GenImage, slots: ["Card.children"] },
      { component: GenImageSet, slots: ["Card.children"] },
    ],
    override: [ImageBlockCard, ImageCard, ImageGalleryCards],
  },
});

/**
 * The one side effect the model may request. Declaring it here is what teaches the
 * generated prompt the `Query("generate_image", ...)` syntax - without it the model
 * invents a `generate_image(...)` function call that never reaches Rust.
 */
export const harnessPromptOptions = {
  tools: [
    {
      name: "generate_image",
      description:
        "Render images with the local ComfyUI. Use only when the user asks to see, draw, sketch, render or imagine a picture, never to decorate text. Emit at most one per program. Anime/manga/cartoon/illustration -> lane \"anime\" with booru-style tags. Photographs, products, real places, realistic people -> lane \"real\" with one natural-language sentence describing camera, light and lens. quality: \"fast\" (default) is a distilled model tuned for seconds per frame - use it for exploration, chat, and anything the user did not ask to be good. quality: \"high\" swaps in the full checkpoint at its recommended settings (Anima 30 steps CFG 5, MOSS-Image bf16 50 steps CFG 3 at 992x1504) and takes one to four minutes per image plus a cold model load - use it when the user says high quality, best, final, print, or asks for one image they care about. count renders 1-8 variations in one batch for the same cost as one model load; use 2-4 for \"options\"/\"variations\"/\"some\", never more than 4 unless asked.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "Booru tags for the anime lane, one natural-language sentence for the real lane.",
          },
          lane: {
            type: "string",
            enum: ["anime", "real"],
            description: "Which model to drive. Defaults to real.",
          },
          quality: {
            type: "string",
            enum: ["fast", "high"],
            description:
              "fast = distilled turbo lanes, seconds per image (default). high = full checkpoints at published settings, minutes per image.",
          },
          count: {
            type: "number",
            description:
              "How many images to render in this batch, 1-8. Defaults to 1. Batches render in one queue item, so 4 costs roughly one load plus 4x sampling.",
          },
          steps: {
            type: "number",
            description:
              "Omit for the lane/quality default (anime 8 fast / 30 high, real 4 fast / 50 high). Only override to trade speed for detail on the fast lanes.",
          },
          nsfw: {
            type: "boolean",
            description:
              "Set true for nude, sexual or explicit requests. Removes the anime template's 'safe' quality tag and the real template's 'nsfw' negative so the prompt is not overwritten. Always accompany it with adult subject tags.",
          },
          width: { type: "number", description: "Defaults to 832 (992 on the high real lane)." },
          height: { type: "number", description: "Defaults to 1216 (1504 on the high real lane)." },
        },
        required: ["prompt"],
      },
      outputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "data: URL of the first image. Pass to GenImage." },
          images: {
            type: "array",
            description: "Every image of the batch as {url, file}. Pass query.images to GenImageSet.",
          },
          file: { type: "string", description: "Local path of the first image; pass to edit_image as source." },
          prompt: { type: "string" },
          lane: { type: "string" },
          quality: { type: "string" },
          seed: { type: "number" },
          steps: { type: "number" },
        },
        required: ["url", "prompt"],
      },
    },
    {
      name: "edit_image",
      description:
        "Change one thing in an image that already exists on disk: the last render, a render from earlier in the conversation, or a file the user names. Runs the klein image-editing model, which repaints the frame conditioned on the source, so everything you do not mention is meant to survive. Use it when the user says change, make it, remove, add, recolor, swap or 'same but' about a picture that already exists. One clear instruction per pass; chain passes for several changes. It cannot invent explicit content the source does not already contain - for a new explicit scene use generate_image instead.",
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
              "Path or filename of the image to edit. Omit to edit the newest render in the harness images directory. Use one of the file paths the system prompt lists under 'Renders in this conversation' - that list holds every image of the conversation, newest first.",
          },
        },
        required: ["prompt"],
      },
      outputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "data: URL of the edited image. Pass to GenImage." },
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
query = Query("generate_image", {prompt: "1girl, solo, red fox ears, autumn forest, golden light", lane: "anime"}, {url: ""})
card = Card([GenImage(query.url, "A red fox girl in an autumn forest")])`,
    `root = Stack([card])
query = Query("generate_image", {prompt: "a baker pulling bread from a stone oven, warm morning light, 35mm", lane: "real", quality: "high"}, {url: ""})
card = Card([GenImage(query.url, "Baker at a stone oven, high quality")])`,
    `root = Stack([card])
query = Query("generate_image", {prompt: "1girl, solo, silver hair, black leather jacket, neon alley", lane: "anime", count: 4}, {url: "", images: []})
card = Card([GenImageSet(query.images, "Silver-haired girl in a neon alley")])`,
    `root = Stack([card])
query = Query("edit_image", {prompt: "Change her jacket to red leather, keep everything else identical."}, {url: ""})
card = Card([GenImage(query.url, "Jacket recoloured to red leather")])`,
  ],
};