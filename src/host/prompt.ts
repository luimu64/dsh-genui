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
 * last. That matters in this deployment: `dsh-liberation` prepends a listener that replaces
 * `assembly.sections` with its own persona and keeps only contexts, tools and variables. A
 * plain listener adds the section before that rewrite and loses it; a prepended one appends
 * after the rewrite and survives. Without liberation in the profile the result is identical —
 * the section is simply appended to the ordinary assembly.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { listRenders } from './images'
import type { ModeStore } from './mode'
import type { Config } from './config'

const SECTION = 'genui:openui'
const CONTEXT = 'genui:renders'

export function openuiPrompt(): string {
  const candidates = [
    new URL('../assets/system-prompt.txt', import.meta.url), // built lib/index.js
    new URL('../../assets/system-prompt.txt', import.meta.url), // src/host/prompt.ts
  ]
  const file = candidates.find((url) => existsSync(fileURLToPath(url)))
  if (!file) throw new Error('dsh-genui: assets/system-prompt.txt not found')
  return readFileSync(file, 'utf8')
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

export function registerAgentPrompt(ctx: Context, config: Config, mode: ModeStore): void {
  const prompt = openuiPrompt()

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
      sections: [...built.sections, { name: SECTION, text: prompt }],
      contexts: renders ? [...built.contexts, { name: CONTEXT, text: renders }] : built.contexts,
    }
  }, { prepend: true } as any)
}
