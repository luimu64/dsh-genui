/**
 * Prompt assembly against the real `SystemPrompt` service, not a stub.
 *
 * A profile may also run a bundle that owns the whole prompt and prepends a listener which
 * replaces `assembly.sections` wholesale. A plain listener adds the OpenUI section before
 * that rewrite and silently loses it: the mode reads on, the route answers, and the model
 * still gets markdown. These tests are the regression.
 */
import { describe, expect, test } from 'bun:test'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { registerAgentPrompt } from '../src/host/prompt'
import { createGenuiHostService } from '../src/host/registry'
import { modeStore, testConfig } from './helpers'

const config = testConfig({ defaultOn: false })

/** A bundle that owns the system prompt: replaces the whole section list. */
function promptReplacer(ctx: Context, text: string): void {
  ctx.on(
    'system-prompt/assemble',
    async (_assembly, _context, next) => {
      const assembly = await next()
      return { ...assembly, sections: [{ name: 'persona:complete', text }] }
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
    registerAgentPrompt(ctx, config, modeStore(new Set(['s-on'])), createGenuiHostService())

    const enabled = await ctx.systemPrompt.assemble({ agent, scope: agent })
    expect(enabled.sections.map((section) => section.name)).toContain('genui:openui')
    expect(enabled.sections.find((section) => section.name === 'genui:openui')?.text).toContain('root = Stack(')

    const other = { session: { id: 's-off', header: {} } } as any
    const disabled = await ctx.systemPrompt.assemble({ agent: other, scope: other })
    expect(disabled.sections.map((section) => section.name)).not.toContain('genui:openui')
  })

  test('stays out of subagent assemblies', async () => {
    const { ctx, agent } = await assemble('s-on', 'subagent')
    registerAgentPrompt(ctx, config, modeStore(new Set(['s-on'])), createGenuiHostService())
    const assembled = await ctx.systemPrompt.assemble({ agent, scope: agent })
    expect(assembled.sections.map((section) => section.name)).not.toContain('genui:openui')
  })

  test('survives a bundle that replaces the whole section list', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    // Mounted first, exactly as the profile orders its bundles.
    promptReplacer(ctx, 'You are a general assistant.')
    registerAgentPrompt(ctx, config, modeStore(new Set(['s-on'])), createGenuiHostService())

    const agent = { session: { id: 's-on', header: {} } } as any
    const assembled = await ctx.systemPrompt.assemble({ agent, scope: agent })
    const names = assembled.sections.map((section) => section.name)
    expect(names).toContain('persona:complete')
    expect(names).toContain('genui:openui')
    // The persona still owns the prompt; the answer format is appended to it.
    expect(names[0]).toBe('persona:complete')
  })

  test('a companion block and its context reach the assembled prompt', async () => {
    const { ctx, agent } = await assemble('s-on')
    const service = createGenuiHostService()
    registerAgentPrompt(ctx, config, modeStore(new Set(['s-on'])), service)
    service.addPromptBlock({ id: 'probe', anchor: 'tools', text: () => '- probe_tool()' })
    service.addContext('probe', () => '### Probe context\n\n- one thing')

    const assembled = await ctx.systemPrompt.assemble({ agent, scope: agent })
    expect(assembled.sections.find((section) => section.name === 'genui:openui')?.text).toContain(
      '- probe_tool()',
    )
    expect(assembled.contexts.map((entry) => entry.name)).toContain('genui:probe')
  })

  test('a companion that unloads takes its text with it', async () => {
    const { ctx, agent } = await assemble('s-on')
    const service = createGenuiHostService()
    registerAgentPrompt(ctx, config, modeStore(new Set(['s-on'])), service)
    const remove = service.addPromptBlock({ id: 'probe', anchor: 'tools', text: () => '- probe_tool()' })

    const before = await ctx.systemPrompt.assemble({ agent, scope: agent })
    expect(before.sections.find((section) => section.name === 'genui:openui')?.text).toContain('- probe_tool()')

    remove()
    const after = await ctx.systemPrompt.assemble({ agent, scope: agent })
    const text = after.sections.find((section) => section.name === 'genui:openui')?.text ?? ''
    expect(text).not.toContain('- probe_tool()')
    expect(text).toContain('This deployment exposes no Query tools')
  })

  test('adds the section once, however often the prompt is assembled', async () => {
    const { ctx, agent } = await assemble('s-on')
    registerAgentPrompt(ctx, config, modeStore(new Set(['s-on'])), createGenuiHostService())
    await ctx.systemPrompt.assemble({ agent, scope: agent })
    const second = await ctx.systemPrompt.assemble({ agent, scope: agent })
    expect(second.sections.filter((section) => section.name === 'genui:openui')).toHaveLength(1)
  })
})
