import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openuiPrompt, registerAgentPrompt, renderList } from '../src/host/prompt'
import { saveRender } from '../src/host/images'

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
})

describe('registerAgentPrompt', () => {
  test('attaches the section to every main agent and decides per conversation', () => {
    const sections: any[] = []
    const contexts: any[] = []
    const listeners = new Map<string, (payload: any) => unknown>()
    const disposers: (() => void)[] = []
    const on = new Set<string>()

    const agent = (id: string, sessionId: string, origin?: 'subagent') => ({
      id,
      session: { id: sessionId, header: { origin } },
      ctx: {
        systemPrompt: {
          section(value: any) {
            sections.push(value)
            return () => {}
          },
          context(value: any) {
            contexts.push(value)
            return () => {}
          },
        },
      },
    })

    // A conversation that was already open when the plugin loaded.
    const existing = agent('a0', 's0')
    const ctx = {
      agents: { list: () => [existing] },
      effect(fn: () => () => void) {
        disposers.push(fn())
        return () => {}
      },
      on(event: string, listener: (payload: any) => unknown) {
        listeners.set(event, listener)
        return () => {}
      },
    } as any

    registerAgentPrompt(ctx, {
      comfyBase: 'http://127.0.0.1:8188',
      imagesDir: '/nonexistent/genui-images',
      maxBatch: 8,
      pollMs: 750,
      minPngBytes: 30_000,
    }, {
      file: '/tmp/x.json',
      isOn: (id: string) => on.has(id),
      set: (id: string, next: boolean) => (next ? on.add(id) : on.delete(id)),
      sessions: () => [...on],
    })

    const created = listeners.get('agent/created')
    expect(created).toBeDefined()
    created!({ agent: agent('a1', 's1') })
    created!({ agent: agent('a2', 's2', 'subagent') })

    // One section for the pre-existing conversation, one for the new one, none for the child.
    expect(sections).toHaveLength(2)
    expect(sections[0].name).toBe('genui:openui')
    // Additive: the harness prompt survives, so this must never claim to be all of it.
    expect(sections[0].complete).toBeUndefined()

    // Off by default, and each conversation answers for itself.
    expect(sections[0].text()).toBe('')
    expect(sections[1].text()).toBe('')
    on.add('s1')
    expect(sections[0].text()).toBe('')
    expect(sections[1].text()).toContain('root = Stack(')
    expect(contexts[1].name).toBe('genui:renders')
    expect(contexts[1].text()).toBe('')

    // And back off again, on the next assembly, for that conversation only.
    on.delete('s1')
    expect(sections[1].text()).toBe('')
    expect(contexts[1].text()).toBe('')
  })
})
