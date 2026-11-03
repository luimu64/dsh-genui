/**
 * `generate_image` returns a batch as `images: [{url, file}, …]` (the shape the
 * tool's outputSchema declares), while the single-image fields are plain
 * strings. `GenImageSet` used to declare `urls: string[]`, so a batch's objects
 * reached the renderer unchanged and every card painted a broken image.
 *
 * This normalises both shapes — and the reactive `{images: []}` placeholder an
 * unrendered query starts with — into the list of data URLs to paint.
 */
export function imageUrls(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      if (item) out.push(item);
      continue;
    }
    if (item && typeof item === "object") {
      const url = (item as { url?: unknown }).url;
      if (typeof url === "string" && url) out.push(url);
    }
  }
  return out;
}
