/**
 * Prompt assembly against the real `SystemPrompt` service, not a stub.
 *
 * The deployment this bundle runs in has a bundle (`dsh-liberation`) that prepends a listener
 * replacing `assembly.sections` wholesale. A plain listener adds the OpenUI section before
 * that rewrite and silently loses it — which is exactly what happened: the mode was on, the
 * route answered, and the model still got markdown. These tests are the regression.
 */
import { describe, expect, test } from 'bun:test'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { registerAgentPrompt } from '../src/host/prompt'
import type { ModeStore } from '../src/host/mode'

const config = {
  comfyBase: 'http://127.0.0.1:8188',
  imagesDir: '/nonexistent/genui-images',
  maxBatch: 8,
  pollMs: 750,
  minPngBytes: 30_000,
}

function store(on: Set<string>): ModeStore {
  return {
    file: '/tmp/genui-mode.json',
    isOn: (id) => on.has(id),
    set: (id, next) => void (next ? on.add(id) : on.delete(id)),
    sessions: () => [...on],
  }
}

/** A bundle that owns the system prompt: replaces the whole section list. */
function promptReplacer(ctx: Context, text: string): void {
  ctx.on(
    'system-prompt/assemble',
    async (_assembly, _context, next) => {
      const assembly = await next()
      return { ...assembly, sections: [{ name: 'liberation:complete', text }] }
    },
    { prepend: true } as any,
  )
}

async function assemble(sessionId: string, origin?: 'subagent') {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  const on = new Set([sessionId])
  const agent = { session: { id: sessionId, header: { origin } } } as any
  return { ctx, on, agent }
}

describe('prompt assembly', () => {
  test('adds the section for an enabled conversation only', async () => {
    const { ctx, agent } = await assemble('s-on')
    registerAgentPrompt(ctx, config, store(new Set(['s-on'])))

    const enabled = await ctx.systemPrompt.assemble({ agent, scope: agent })
    expect(enabled.sections.map((section) => section.name)).toContain('genui:openui')
    expect(enabled.sections.find((section) => section.name === 'genui:openui')?.text).toContain('root = Stack(')

    const other = { session: { id: 's-off', header: {} } } as any
    const disabled = await ctx.systemPrompt.assemble({ agent: other, scope: other })
    expect(disabled.sections.map((section) => section.name)).not.toContain('genui:openui')
  })

  test('stays out of subagent assemblies', async () => {
    const { ctx, agent } = await assemble('s-on', 'subagent')
    registerAgentPrompt(ctx, config, store(new Set(['s-on'])))
    const assembled = await ctx.systemPrompt.assemble({ agent, scope: agent })
    expect(assembled.sections.map((section) => section.name)).not.toContain('genui:openui')
  })

  test('survives a bundle that replaces the whole section list', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    // Mounted first, exactly as the profile orders its bundles.
    promptReplacer(ctx, 'You are a general assistant.')
    registerAgentPrompt(ctx, config, store(new Set(['s-on'])))

    const agent = { session: { id: 's-on', header: {} } } as any
    const assembled = await ctx.systemPrompt.assemble({ agent, scope: agent })
    const names = assembled.sections.map((section) => section.name)
    expect(names).toContain('liberation:complete')
    expect(names).toContain('genui:openui')
    // The persona still owns the prompt; the answer format is appended to it.
    expect(names[0]).toBe('liberation:complete')
  })

  test('adds the section once, however often the prompt is assembled', async () => {
    const { ctx, agent } = await assemble('s-on')
    registerAgentPrompt(ctx, config, store(new Set(['s-on'])))
    await ctx.systemPrompt.assemble({ agent, scope: agent })
    const second = await ctx.systemPrompt.assemble({ agent, scope: agent })
    expect(second.sections.filter((section) => section.name === 'genui:openui')).toHaveLength(1)
  })
})
