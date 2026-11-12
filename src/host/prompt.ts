/**
 * The OpenUI system prompt, added at assembly time on the main agent only.
 *
 * Two things this deliberately does NOT do:
 *
 * - it is not `complete`: the harness keeps its identity, tools, sandbox and approval policy,
 *   and this only adds the answer format on top;
 * - it is not registered per agent through `agent.ctx`. A section registered that way only
 *   exists for agents the plugin saw being created, so conversations that were already open,
 *   or opened while the plugin was reloading, answered in markdown no matter what the mode
 *   said. The assembly waterfall sees every request, so the mode is decided where the prompt is
 *   actually built, and `/openui on` works immediately in any conversation.
 *
 * The listener is PREPENDED, which in a Cordis waterfall means its post-`next()` code runs
 * last. That matters beside any bundle that owns the whole prompt: such a bundle prepends a
 * listener that replaces `assembly.sections` with its own persona and keeps only contexts,
 * tools and variables. A plain listener adds the section before that rewrite and loses it; a
 * prepended one appends after the rewrite and survives. With no such bundle in the profile
 * the result is identical - the section is simply appended to the ordinary assembly.
 *
 * This bundle knows the answer format, not the tools a companion bundle serves. Those are
 * registered as blocks (see `registry.ts`) and poured into the anchors the committed assets
 * carry, so a deployment without image generation gets a prompt that says exactly that.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

import type { ModeStore } from './mode'
import type { Config } from './config'
import type { ComponentDoc, GenuiHostService, PromptAnchor } from './registry'

const SECTION = 'genui:openui'

/** Where a companion bundle's text lands in the committed assets. */
const ANCHORS = {
  tools: '<!-- genui:tools -->',
  examples: '<!-- genui:examples -->',
  rules: '<!-- genui:rules -->',
  components: '<!-- genui:components -->',
} as const

/**
 * The catalogue subsection a companion's components join. Nothing is written when nothing is
 * registered: an empty heading above no components reads as a broken prompt, and the catalogue
 * is exactly where a model looks for something to call.
 */
export const COMPONENT_HEADING = '### Components from other bundles'

export function componentCatalogue(docs: readonly ComponentDoc[]): string {
  if (docs.length === 0) return ''
  const lines = docs.map((doc) => `${doc.signature} — ${doc.description}`)
  return [
    COMPONENT_HEADING,
    '',
    'Ordinary components from bundles installed beside this one: same syntax, same action rules.',
    'Use one when it is the honest shape for the answer.',
    '',
    ...lines,
  ].join('\n')
}

/**
 * What "Available Tools" says when nothing registered a tool.
 *
 * A section that promises a catalogue and then shows none reads as a broken prompt, and a
 * model will invent a tool name to fill it. Saying it plainly is the honest version: there is
 * nothing to Query here.
 */
export const NO_TOOLS = [
  'This deployment exposes no Query tools. A `Query(...)` would resolve to nothing, so build',
  'the answer from what you already know and from ordinary components.',
].join('\n')

/** Read one prompt asset, from the built bundle or from source. */
function asset(name: string): string {
  const candidates = [
    new URL(`../assets/${name}`, import.meta.url), // built lib/index.js
    new URL(`../../assets/${name}`, import.meta.url), // src/host/prompt.ts
  ]
  const file = candidates.find((url) => existsSync(fileURLToPath(url)))
  if (!file) throw new Error(`dsh-genui: assets/${name} not found`)
  return readFileSync(file, 'utf8').trimEnd()
}

/** The part of the host service the prompt reads. */
export type PromptSource = Pick<
  GenuiHostService,
  'blocks' | 'components' | 'contexts' | 'addContext' | 'addPromptBlock' | 'addComponents'
>

const EMPTY_SOURCE: PromptSource = {
  blocks: () => [],
  components: () => [],
  contexts: () => [],
  addContext: () => () => {},
  addPromptBlock: () => () => {},
  addComponents: () => () => {},
}

/**
 * Replace one anchor with the blocks registered for it. An anchor nothing registered leaves
 * `fallback` behind, so the section around it still reads as a sentence.
 */
export function fillAnchor(text: string, marker: string, blocks: readonly string[], fallback = ''): string {
  const at = text.indexOf(marker)
  if (at < 0) return text
  const body = (blocks.join('\n\n') || fallback).trim()
  // One paragraph break on either side, whether the anchor stayed empty or not: a marker
  // line removed without this leaves three blank lines where a section should breathe once.
  const before = text.slice(0, at).replace(/\n+$/, '')
  const after = text.slice(at + marker.length).replace(/^\n+/, '')
  return body === '' ? `${before}\n\n${after}` : `${before}\n\n${body}\n\n${after}`
}

/**
 * The section the model reads, assembled from parts:
 *
 * - `prompt-core.txt` — the OpenUI language and catalogue, with the tool catalogue and the
 *   examples open for blocks;
 * - every registered `append` block — a workflow's own conventions live here;
 * - `prompt-rules.md` — the hand-written harness rules, always last.
 *
 * The registry owns which blocks exist, so a companion bundle brings its own prompt text
 * without an edit here, and a deployment without it simply has none.
 */
export function openuiPrompt(source: PromptSource = EMPTY_SOURCE): string {
  const catalogue = componentCatalogue(source.components())
  const core = fillAnchor(
    fillAnchor(
      fillAnchor(asset('prompt-core.txt'), ANCHORS.tools, source.blocks('tools'), NO_TOOLS),
      ANCHORS.examples,
      source.blocks('examples'),
    ),
    ANCHORS.components,
    catalogue ? [catalogue] : [],
  )
  const rules = fillAnchor(asset('prompt-rules.md'), ANCHORS.rules, source.blocks('rules'))
  const parts = [core, ...source.blocks('append'), rules]
  return `${parts.map((part) => part.trimEnd()).join('\n\n')}\n`
}

/** The agent behind one assembly, when the caller supplied it. */
function agentOf(context: unknown): any {
  const candidate = (context as { agent?: unknown } | undefined)?.agent
  return candidate && typeof candidate === 'object' ? candidate : undefined
}

export function registerAgentPrompt(
  ctx: Context,
  config: Config,
  mode: ModeStore,
  service: GenuiHostService,
): void {
  // Built per assembly rather than captured: the mode, the enabled workflows and the renders
  // on disk all move while the harness runs, and three small file reads per model request is
  // cheaper than a cache that can serve last week's prompt.
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const built = await next()
    const agent = agentOf(context)
    // Subagents keep DSH's normal prompt and return normal text to their caller.
    if (agent?.session?.header?.origin === 'subagent') return built
    const sessionId = typeof agent?.session?.id === 'string' ? agent.session.id : ''
    if (!sessionId || !mode.isOn(sessionId)) return built
    if (built.sections.some((section) => section.name === SECTION)) return built

    const contexts = service.contexts().map((entry) => ({ name: `genui:${entry.id}`, text: entry.text }))
    return {
      ...built,
      sections: [...built.sections, { name: SECTION, text: openuiPrompt(service) }],
      contexts: contexts.length > 0 ? [...built.contexts, ...contexts] : built.contexts,
    }
  }, { prepend: true } as any)
}
