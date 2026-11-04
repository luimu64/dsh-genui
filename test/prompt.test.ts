import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openuiPrompt, registerAgentPrompt, renderList } from '../src/host/prompt'
import { saveRender } from '../src/host/images'
import { testConfig } from './helpers'

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'genui-'))
}

describe('renderList', () => {
  test('names the newest render first', async () => {
    const dir = await tempDir()
    try {
      await saveRender(dir, 'older.png', new Uint8Array([1]))
      await new Promise((r) => setTimeout(r, 20))
      await saveRender(dir, 'newer.png', new Uint8Array([2]))
      const text = renderList(dir, 2)
      expect(text).toContain('### Renders in this conversation')
      expect(text).toContain('(newest)')
      expect(text.indexOf('newer.png')).toBeLessThan(text.indexOf('older.png'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('is empty when there is nothing to edit', () => {
    expect(renderList('/nonexistent/genui-images')).toBe('')
  })

  test('is synchronous, because the prompt context cannot await', () => {
    const value = renderList('/nonexistent/genui-images')
    expect(typeof (value as unknown as { then?: unknown }).then).not.toBe('function')
  })
})

describe('openuiPrompt', () => {
  test('reads the committed prompt', () => {
    const text = openuiPrompt()
    expect(text.length).toBeGreaterThan(10_000)
    expect(text).toContain('root = Stack(')
  })

  test('is written to sit beside the harness prompt, not instead of it', () => {
    const text = openuiPrompt()
    expect(text.startsWith('## Answer format')).toBe(true)
    // The old opening claimed the entire system prompt; that breaks as an additive section.
    expect(text).not.toContain('Your ENTIRE response must be valid openui-lang code')
    expect(text).toContain('only the final assistant message of a turn is a program')
    expect(text).toContain('You are the same assistant')
  })

  test('names the two tools the harness actually exposes', () => {
    const text = openuiPrompt()
    expect(text).toContain('web_search(queries: string[])')
    expect(text).toContain('web_fetch(url: string)')
    expect(text).not.toContain('web_extract')
    expect(text).not.toContain('maxResults')
    expect(text).not.toContain('not a browser')
  })

  test('describes the two image queries the library declares', () => {
    const text = openuiPrompt()
    expect(text).toContain('generate_image')
    expect(text).toContain('edit_image')
  })

  test('forbids probing ComfyUI before a query', () => {
    const text = openuiPrompt()
    expect(text).toContain('Never check on ComfyUI yourself')
    expect(text).toContain('no `/system_stats`')
  })
})

describe('registerAgentPrompt', () => {
  test('adds the section at assembly, for that conversation only', async () => {
    const listeners = new Map<string, (assembly: any, context: any, next: () => Promise<any>) => Promise<any>>()
    const on = new Set<string>()

    const ctx = {
      on(name: string, listener: any) {
        listeners.set(name, listener)
        return () => {}
      },
    } as any

    registerAgentPrompt(ctx, testConfig({ defaultOn: false }), {
      file: '/tmp/x.json',
      defaultOn: false,
      isOn: (id: string) => on.has(id),
      set: (id: string, next: boolean) => (next ? on.add(id) : on.delete(id)),
      sessions: () => [...on],
      offSessions: () => [],
    })

    const assemble = listeners.get('system-prompt/assemble')
    expect(assemble).toBeDefined()

    const base = { sections: [{ name: 'deployment:persona-prefix', text: 'You are a coding agent.' }], contexts: [], tools: [], variables: {} }
    const next = async () => structuredClone(base)
    const agent = (id: string, origin?: 'subagent') => ({ session: { id, header: { origin } } })

    const off = await assemble!({ ...base }, { agent: agent('s1') }, next)
    expect(off.sections.map((s: any) => s.name)).toEqual(['deployment:persona-prefix'])

    on.add('s1')
    const mine = await assemble!({ ...base }, { agent: agent('s1') }, next)
    expect(mine.sections.map((s: any) => s.name)).toEqual(['deployment:persona-prefix', 'genui:openui'])
    expect(mine.sections[1].text).toContain('root = Stack(')

    // Another conversation is untouched, and so is a subagent.
    const other = await assemble!({ ...base }, { agent: agent('s2') }, next)
    expect(other.sections).toHaveLength(1)
    const child = await assemble!({ ...base }, { agent: agent('s3', 'subagent') }, next)
    expect(child.sections).toHaveLength(1)

    // Assembling twice never stacks the section.
    const again = await assemble!({ ...base }, { agent: agent('s1') }, next)
    expect(again.sections).toHaveLength(2)

    // And off again lands on the next assembly.
    on.delete('s1')
    const back = await assemble!({ ...base }, { agent: agent('s1') }, next)
    expect(back.sections).toHaveLength(1)
  })
})

describe('the committed prompt', () => {
  test('ends with the rules asset, so a regeneration cannot silently drop them', () => {
    const rules = readFileSync(new URL('../assets/prompt-rules.md', import.meta.url), 'utf8').trimEnd()
    expect(rules.length).toBeGreaterThan(1000)
    expect(openuiPrompt().trimEnd().endsWith(rules)).toBe(true)
  })

  test('carries no absolute path from the machine that generated it', () => {
    expect(openuiPrompt()).not.toContain('/home/')
  })
})
