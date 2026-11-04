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
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

import { listRenders } from './images'
import type { ModeStore } from './mode'
import { workflowsOf, type Config } from './config'
import type { WorkflowRegistry } from './workflows'

const SECTION = 'genui:openui'
const CONTEXT = 'genui:renders'

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

/**
 * The section the model reads, assembled from parts:
 *
 * - `prompt-core.txt` — the OpenUI catalogue and the tool surface of the default workflows;
 * - one section per enabled workflow that ships one (`assets/prompt-anime.md` today);
 * - `prompt-rules.md` — the hand-written harness rules, always last.
 *
 * The registry owns which sections exist, so a new workflow brings its own prompt text
 * without an edit here.
 */
export function openuiPrompt(sections: readonly string[] = []): string {
  const parts = [asset('prompt-core.txt'), ...sections.filter((text) => text.trim() !== ''), asset('prompt-rules.md')]
  return `${parts.map((part) => part.trimEnd()).join('\n\n')}\n`
}

/**
 * The renders this conversation can still edit, newest first. Synchronous on purpose: the
 * prompt is assembled synchronously per request.
 */
export function renderList(imagesDir: string, limit = 20): string {
  const renders = listRenders(imagesDir, limit)
  if (renders.length === 0) return ''
  const lines = renders.map((render, index) => `- ${render.file}${index === 0 ? ' (newest)' : ' (older)'}`)
  return ['### Renders in this conversation', '', ...lines].join('\n')
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
  registry: WorkflowRegistry,
): void {
  // Built per assembly rather than captured: the enabled set is a volatile field, and a
  // workflow may also change its prompt section on disk. Three small file reads per model
  // request is cheaper than a cache that can serve last week's prompt.
  const promptNow = (): string => openuiPrompt(registry.prompts(workflowsOf(config)))

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const built = await next()
    const agent = agentOf(context)
    // Subagents keep DSH's normal prompt and return normal text to their caller.
    if (agent?.session?.header?.origin === 'subagent') return built
    const sessionId = typeof agent?.session?.id === 'string' ? agent.session.id : ''
    if (!sessionId || !mode.isOn(sessionId)) return built
    if (built.sections.some((section) => section.name === SECTION)) return built

    const renders = renderList(config.imagesDir)
    return {
      ...built,
      sections: [...built.sections, { name: SECTION, text: promptNow() }],
      contexts: renders ? [...built.contexts, { name: CONTEXT, text: renders }] : built.contexts,
    }
  }, { prepend: true } as any)
}
