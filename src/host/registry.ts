/**
 * The one thing an optional companion plugin may contribute to the answer format: prompt text.
 *
 * `dsh-genui` owns the assembled system prompt and nothing else may rewrite it. A bundle that
 * teaches the model about a `Query()` tool it serves (image generation, say) registers a block
 * here, the same way a workflow definition brings its own prompt section. Without that bundle
 * the block simply is not there, the anchors stay empty, and the prompt describes a deployment
 * whose Query() surface is empty.
 *
 * Anchors name a position in the committed prompt, not a whole section: `tools` is the tool
 * catalogue inside "Available Tools", `examples` appends to "Examples", `rules` lands between
 * the harness's own rules, and `append` is the free tail before them - where a workflow's own
 * conventions belong. Text is a reader, not a string, because the blocks that matter most are
 * the ones that follow live state (the renders a conversation can still edit, the workflows a
 * settings row just switched on).
 */
import type {} from '@deepseek-ai/cordis'

export type PromptAnchor = 'tools' | 'examples' | 'rules' | 'append'

export interface PromptBlock {
  /** Stable id: registering the same id again replaces the block instead of stacking it. */
  id: string
  anchor?: PromptAnchor
  /** Read at assembly time, never captured. */
  text: () => string
}

/**
 * One component a companion adds, as the model reads it. The renderer paints the same component
 * through `ctx.genuiClient.registerComponents`; this is the half that teaches the catalogue,
 * and it has to be written by hand because the browser bundle is not loadable from here.
 */
export interface ComponentDoc {
  /** The name a program calls. The renderer must register the same name. */
  name: string
  /** The call shape, left half of the catalogue line: `StarRating(label: string, value?: number)`. */
  signature: string
  /** What it is and when to reach for it, in the catalogue's own voice. */
  description: string
}

export interface GenuiHostService {
  /** Contribute model-facing text. The returned disposer removes it again. */
  addPromptBlock(block: PromptBlock): () => void
  /** Contribute components to the catalogue, beside the built-in ones. */
  addComponents(docs: ComponentDoc[]): () => void
  /** Contribute one additional `contexts` entry to an assembled prompt. */
  addContext(id: string, text: () => string): () => void
  /** The blocks registered for one anchor, in registration order, empty text dropped. */
  blocks(anchor: PromptAnchor): string[]
  /** The components registered right now, in registration order. */
  components(): ComponentDoc[]
  /** The contexts registered right now, empty text dropped. */
  contexts(): { id: string; text: string }[]
}

const EMPTY = ''

export function createGenuiHostService(): GenuiHostService {
  const blocks = new Map<string, PromptBlock>()
  const components = new Map<string, ComponentDoc>()
  const contexts = new Map<string, () => string>()

  const read = (reader: () => string): string => {
    try {
      return reader().trim()
    } catch {
      // A block whose state cannot be read is a paragraph missing from the prompt, never a
      // failed turn: the model answers from what it has.
      return EMPTY
    }
  }

  return {
    addPromptBlock(block) {
      blocks.set(block.id, block)
      return () => {
        // Only this registration's disposer: a reload that already replaced the block must
        // not remove the newer one on its way out.
        if (blocks.get(block.id) === block) blocks.delete(block.id)
      }
    },

    addComponents(docs) {
      const installed: ComponentDoc[] = []
      for (const doc of docs) {
        components.set(doc.name, doc)
        installed.push(doc)
      }
      return () => {
        for (const doc of installed) {
          if (components.get(doc.name) === doc) components.delete(doc.name)
        }
      }
    },

    addContext(id, text) {
      contexts.set(id, text)
      return () => {
        if (contexts.get(id) === text) contexts.delete(id)
      }
    },

    blocks(anchor) {
      const out: string[] = []
      for (const block of blocks.values()) {
        if ((block.anchor ?? 'append') !== anchor) continue
        const text = read(block.text)
        if (text !== EMPTY) out.push(text)
      }
      return out
    },

    components() {
      return [...components.values()]
    },

    contexts() {
      const out: { id: string; text: string }[] = []
      for (const [id, reader] of contexts) {
        const text = read(reader)
        if (text !== EMPTY) out.push({ id, text })
      }
      return out
    },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The OpenUI host surface: prompt blocks and contexts an optional plugin may add. */
    genui: GenuiHostService
  }
}
