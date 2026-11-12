/**
 * The component library, as a registry a companion bundle can add to.
 *
 * A component is two things that have to agree: a renderer the browser paints, and a line of
 * prompt text that tells the model it exists and when to reach for it. The renderer half lives
 * here — one library derived from the shipped one plus every contribution, rebuilt only when
 * the set of contributions changes. The prompt half is the host's: a companion registers the
 * same component with `ctx.genui.addComponents`, which is what puts its signature and its
 * "use it when…" beside the built-in catalogue.
 *
 * Deriving instead of mutating is forced by the renderer: it memoizes a parser by library
 * identity, so a mutated library would never be re-read. One new identity per change, cached
 * until the next one, is what makes a component registered a moment after the row mounted
 * still paint.
 */
import { openuiLibrary } from '@openuidev/react-ui'
import type { DefinedComponent, Library } from '@openuidev/react-lang'

/** One entry a companion hands over: the renderer, and where the component may appear. */
export interface ComponentContribution {
  // `any` on the schema parameter on purpose: contributions come from other packages with
  // their own zod instance, and a stricter parameter would refuse every one of them.
  component: DefinedComponent<any>
  /**
   * The parent prop unions this component joins — `"Card.children"`, or a bare `"Card"` when
   * the parent has one slot. Omitted, it is callable but drawn nowhere.
   */
  slots?: string[]
  /**
   * Replace a shipped component of the same name (schema and renderer) instead of adding one.
   * Every parent that named it points at the replacement, which is why this is the only way to
   * change how `ImageBlock` or `Image` is painted.
   */
  override?: boolean
}

const contributions = new Map<string, ComponentContribution>()
const listeners = new Set<() => void>()
let version = 0
let cached: { version: number; library: Library } | null = null

function emit(): void {
  version += 1
  cached = null
  for (const listener of listeners) listener()
}

/**
 * Add or replace components. The disposer removes exactly this registration, so a reload that
 * already installed a newer one does not take it away on its way out.
 *
 * A name that collides with a shipped component is refused rather than silently shadowed: the
 * model has been told what that name means, and a plugin that changes its behaviour has to say
 * `override: true` out loud.
 */
export function registerComponents(entries: ComponentContribution[]): () => void {
  const installed: [string, ComponentContribution][] = []
  for (const entry of entries) {
    const name = entry.component.name
    if (!entry.override && name in openuiLibrary.components) {
      throw new Error(
        `"${name}" is a shipped component: register it with override: true, or pick another name`,
      )
    }
    contributions.set(name, entry)
    installed.push([name, entry])
  }
  if (installed.length) {
    // Build it now, and refuse the whole registration if it does not build: a bad slot name
    // is a plugin bug, and finding it here is a load error instead of a throw inside a render,
    // where it would take down the answer that happened to be on screen.
    try {
      derive()
    } catch (err) {
      for (const [name, entry] of installed) {
        if (contributions.get(name) === entry) contributions.delete(name)
      }
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`dsh-genui: cannot add ${installed.map(([name]) => name).join(', ')}: ${message}`)
    }
    emit()
  }
  return () => {
    let changed = false
    for (const [name, entry] of installed) {
      if (contributions.get(name) === entry) {
        contributions.delete(name)
        changed = true
      }
    }
    if (changed) emit()
  }
}

function derive(): Library {
  if (contributions.size === 0) return openuiLibrary
  const add: (DefinedComponent<any> | { component: DefinedComponent<any>; slots: string[] })[] = []
  const override: DefinedComponent<any>[] = []
  for (const entry of contributions.values()) {
    if (entry.override) override.push(entry.component)
    // An omitted `slots` is not the same as an empty one: the library refuses the empty array
    // and reads the missing key as "listed, in no parent".
    else if (entry.slots?.length) add.push({ component: entry.component, slots: entry.slots })
    else add.push(entry.component)
  }
  return openuiLibrary.extend!({ components: { add, override } })
}

/** The library to hand the renderer. A new object only when a contribution changed. */
export function componentLibrary(): Library {
  if (!cached) cached = { version, library: derive() }
  return cached.library
}

/** Bumps on every registration change; the renderer subscribes to it. */
export function componentVersion(): number {
  return version
}

export function subscribeComponents(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test seam: the names a companion has added, in registration order. */
export function registeredComponentNames(): string[] {
  return [...contributions.keys()]
}
