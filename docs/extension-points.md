# Extension points: how a companion bundle joins this one

`dsh-genui` answers in interface and paints it. It does not *make* anything. Anything that
costs money, owns a machine or reads a directory belongs to a companion bundle that registers
itself here — `dsh-genui-images` is the one this repository ships against, and it is the
worked example of everything below.

Two services carry the whole contract. Both are plain Cordis services, both are optional, and
neither reaches into the other package's files: the companion declares the shape it needs
locally (`src/host/genui.ts`, `src/client/contract.ts` there) and waits for the service with
`inject`.

## Host: `ctx.genui`

Published by `src/host/registry.ts`, read by the prompt assembly on every request.

```ts
type PromptAnchor = 'tools' | 'examples' | 'rules' | 'append'

interface PromptBlock {
  id: string            // stable: re-registering the same id replaces it
  anchor?: PromptAnchor // default 'append'
  text: () => string    // read at assembly time, never captured
}

interface GenuiHostService {
  addPromptBlock(block: PromptBlock): () => void
  addComponents(docs: ComponentDoc[]): () => void
  addContext(id: string, text: () => string): () => void
}
```

`Anchor` names a place in the committed assets, which carry a marker for each:

| Anchor | Marker in | Where the text lands |
|---|---|---|
| `tools` | `assets/prompt-core.txt` | inside "Available Tools", where the tool catalogue belongs |
| `examples` | `assets/prompt-core.txt` | after the committed examples, inside "Examples" |
| `rules` | `assets/prompt-rules.md` | between the harness's own `### Web` and `### Style` |
| `append` | — | after the whole core text, before the harness rules |

`addComponents` has its own anchor, `<!-- genui:components -->`, at the end of the shipped
component catalogue — that is where a companion's components are listed, in the same
`Name(args) — description` shape the built-ins use. See [Components](#components).

`tools` has a fallback: with nothing registered the section says the deployment exposes no
`Query()` tools, because a section that promises a catalogue and shows none teaches a model to
invent tool names.

The text reader is a function because the blocks that matter follow live state: the enabled
workflows come from a volatile config field, and the renders a conversation can still edit come
off disk. A reader that throws drops its block for that request rather than failing the turn.

A companion's `apply` typically looks like:

```ts
export const inject = ['webServer', 'genui']

export function apply(ctx, config) {
  ctx.effect(() => {
    const strips = [
      ctx.genui.addPromptBlock({ id: 'images:tools', anchor: 'tools', text: toolsBlock }),
      ctx.genui.addContext('renders', () => renderList(config.imagesDir)),
    ]
    return () => strips.forEach((strip) => strip())
  })
}
```

## Browser: `ctx.genuiClient`

Published by `src/client/service.ts`, read by the row that paints an answer.

```ts
interface ComponentContribution {
  component: DefinedComponent   // from defineComponent(...)
  slots?: string[]              // "Card.children", or "Card" for a single-slot parent
  override?: boolean            // re-point a shipped component instead of adding one
}

interface GenuiTurnAccess {
  allowGeneration: boolean
  mayGenerate(): boolean
  retry(): void
}

type QueryTool = (args: Record<string, unknown>, turn: GenuiTurnAccess) => Promise<unknown>

interface GenuiFrameSource {
  keyOf(urls: unknown): string | null
  subscribe(key: string, listener: () => void): () => void
  version(key: string): number
  slots(key: string): { url?: string; error?: string; missing?: boolean; prompt?: string }[] | null
}

interface GenuiClientService {
  registerQueryTools(tools: Record<string, QueryTool>): () => void
  registerFrameSource(source: GenuiFrameSource): () => void
}
```

`turn` is why a tool is a function and not an object: the same `Query("generate_image", …)`
means "make one" in the answer the user is reading and "show me one you already made" in an
answer replayed from last week. `mayGenerate()` is the renderer's answer, and a tool that
ignores it will spend a GPU every time a conversation is opened.

A `FrameSource` is how a set of pictures fills in cell by cell. `GenImageSet` asks it for the
batch key, subscribes, and repaints from `slots()`; with no source registered it paints the
URLs the program carries, so the component works in a deployment without any image bundle.

## Components

A component is two halves that have to agree, because they live on opposite sides of the
browser: the renderer the page paints (`ctx.genuiClient.registerComponents`) and the line of
catalogue text that tells the model the component exists and when to use it
(`ctx.genui.addComponents`). The host cannot read the browser bundle, so the halves are declared
separately — and the way to keep them from drifting is to declare them once, in a module both
halves import.

```ts
// my-bundle/src/shared/star.ts — plain data, no React
export const STAR = {
  name: 'StarRating',
  signature: 'StarRating(label: string, value?: number, max?: number)',
  description:
    'Five stars, filled to `value`. Use it for a quick rating or a score the reader asked for, ' +
    'not as decoration on a card that already says the number.',
}
```

```tsx
// my-bundle/src/client/index.tsx
import { defineComponent } from '@openuidev/react-lang'
import { z } from 'zod/v4'
import { STAR } from '../shared/star'

const StarRating = defineComponent({
  name: STAR.name,
  description: STAR.description,
  props: z.object({ label: z.string(), value: z.number().optional(), max: z.number().optional() }),
  component: ({ props }) => /* paint it */ null,
})

export function apply(ctx) {
  ctx.inject(['genuiClient'], (scoped) => {
    scoped.effect(() =>
      scoped.genuiClient.registerComponents([
        { component: StarRating, slots: ['Card.children'] },
      ]),
    )
  })
}
```

```ts
// my-bundle/src/host/index.ts
import { STAR } from '../shared/star'

export const inject = ['genui']

export function apply(ctx) {
  ctx.effect(() => ctx.genui.addComponents([STAR]))
}
```

The component then appears in the prompt's `### Components from other bundles` subsection,
directly under the shipped catalogue, in the same `Name(args) — description` shape — which is
what makes the model treat it as an ordinary component rather than a special case. Nothing is
written there when nothing is registered.

Three rules the registry enforces, all at load time rather than at paint time:

- **A shipped name must be claimed with `override: true`.** `StarRating` is free; `ImageBlock`
  is not. An override changes every parent that named it, which is the only way to restyle a
  shipped component.
- **A slot has to exist.** `slots: ['Card.children']` joins a real content slot; a typo throws
  from `registerComponents` with the component's name in the message, before any answer paints.
  Omit `slots` entirely to add a component that is not nested anywhere.
- **A registration is disposable.** Both halves return a disposer; wrap them in `ctx.effect` so
  disabling the bundle takes its component and its prompt line away without a reload.

## Rules a companion should keep

- **Register, do not edit.** A companion never writes into this bundle's assets or prompt.
  Everything it wants the model to know goes through `addPromptBlock`.
- **Dispose everything.** Both services return disposers, and both are meant to be wrapped in
  `ctx.effect`, so disabling the bundle mid-session removes its text and its tools.
- **Keep the paths you inherited.** `/genui/images/<file>` and the `dsh-genui` data directory
  are named by stored conversations, browser caches and render indexes. A companion that
  renames them loses every picture that already exists.
- **Two names, never one.** The host service is `genui`, the browser service is `genuiClient`.
  One name would make the type graph claim the wrong half.
- **A component ships both halves or neither.** A renderer with no catalogue line is a component
  the model will never call; a catalogue line with no renderer is an answer that dies with
  "unknown component".
