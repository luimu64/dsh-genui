/**
 * The OpenUI system prompt, registered on the main agent only.
 *
 * genui made every answer an openui-lang program by making that the whole system prompt.
 * DSH keeps its own prompt for tools and safety, so this section is `complete: true` for the
 * top-level agent and absent for subagents: a child that returns OpenUI code instead of a
 * result is useless to the parent.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { listRenders } from './images'
import type { ModeStore } from './mode'
import type { Config } from './config'

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
 * The renders this conversation can still edit, newest first. Synchronous on purpose: a
 * `PromptContext.text` that returns a Promise breaks prompt assembly.
 */
export function renderList(imagesDir: string, limit = 20): string {
  const renders = listRenders(imagesDir, limit)
  if (renders.length === 0) return ''
  const lines = renders.map((render, index) => `- ${render.file}${index === 0 ? ' (newest)' : ' (older)'}`)
  return ['### Renders in this conversation', '', ...lines].join('\n')
}

export function registerAgentPrompt(ctx: Context, config: Config, mode: ModeStore): void {
  const prompt = openuiPrompt()
  const disposers = new Map<string, () => void>()

  ctx.effect(() => () => {
    for (const dispose of disposers.values()) dispose()
    disposers.clear()
  })

  ctx.on('agent/created', ({ agent }) => {
    // Subagents keep DSH's normal prompt and return normal text.
    if (agent.session.header.origin === 'subagent') return undefined
    // Additive, never `complete`: the harness keeps its identity, tools, sandbox and approval
    // policy, and this only adds the answer format on top. A complete section would replace
    // the whole prompt, and a preset that owns one would make assembly throw.
    // Both providers are read at every assembly, so /openui takes effect on the next turn
    // without recreating the agent. An empty section and an empty context both contribute
    // nothing.
    const offSection = agent.ctx.systemPrompt.section({
      name: 'genui:openui',
      order: 950,
      text: () => (mode.enabled() ? prompt : ''),
    })
    const offContext = agent.ctx.systemPrompt.context({
      name: 'genui:renders',
      order: 900,
      text: () => (mode.enabled() ? renderList(config.imagesDir) : ''),
    })
    disposers.set(agent.id, () => {
      offSection()
      offContext()
    })
  })

  ctx.on('agent/disposed', ({ agent }) => {
    disposers.get(agent.id)?.()
    disposers.delete(agent.id)
  })
}
