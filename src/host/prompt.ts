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

/** Presets whose persona already claims the whole system prompt (`complete: true`). */
const COMPLETE_PRESETS = new Set(['minimal'])

export function registerAgentPrompt(ctx: Context, config: Config): void {
  const prompt = openuiPrompt()
  const disposers = new Map<string, () => void>()

  ctx.effect(() => () => {
    for (const dispose of disposers.values()) dispose()
    disposers.clear()
  })

  const log = ctx.logger('dsh-genui')

  ctx.on('agent/created', ({ agent }) => {
    // Subagents keep DSH's normal prompt and return normal text.
    if (agent.session.header.origin === 'subagent') return undefined
    // A complete section is exclusive by contract: the shipped `minimal` agent preset also
    // registers one, and two of them make prompt assembly throw for every turn. Skipping is
    // the only safe answer — that preset's agent then behaves like a normal chat instead of
    // failing to run at all.
    if (COMPLETE_PRESETS.has(agent.session.header.agentPreset ?? '')) {
      log.warn('agent preset %s owns the complete system prompt; OpenUI is off for this session', agent.session.header.agentPreset)
      return undefined
    }
    const offSection = agent.ctx.systemPrompt.section({
      name: 'genui:openui',
      order: 100,
      text: prompt,
      complete: true,
    })
    const offContext = agent.ctx.systemPrompt.context({
      name: 'genui:renders',
      order: 900,
      text: () => renderList(config.imagesDir),
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
