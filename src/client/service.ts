/**
 * The browser-side face this bundle offers an optional companion.
 *
 * Three things a companion plugin needs and the renderer owns: somewhere to put the `Query()`
 * tools it serves, a way to add components to the library, and a way to say that an image list
 * is a batch still filling in. All three are registries, so the dependency points one way - the
 * companion needs the renderer, the renderer needs nothing installed.
 *
 * The service is published as `genuiClient`, deliberately not `genui`: the host half publishes
 * a `genui` service of its own, and one name for two different contexts is how a type graph
 * starts lying about which half it is typing.
 */
import type {} from '@deepseek-ai/cordis'
import { registerComponents, type ComponentContribution } from './components'
import { registerFrameSource, type FrameSource } from './frames'
import { registerQueryTools, type QueryTool } from './tools'

export interface GenuiClientService {
  /** Add or replace Query tools. The disposer removes that registration. */
  registerQueryTools(tools: Record<string, QueryTool>): () => void
  /** Add components to the library the renderer paints with. */
  registerComponents(entries: ComponentContribution[]): () => void
  /** Take over progressive image frames. The disposer releases them. */
  registerFrameSource(source: FrameSource): () => void
}

export function createGenuiClientService(): GenuiClientService {
  return { registerQueryTools, registerComponents, registerFrameSource }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The renderer's extension surface for a companion plugin's browser half. */
    genuiClient: GenuiClientService
  }
}
