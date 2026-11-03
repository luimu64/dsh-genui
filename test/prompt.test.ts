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
  test('gives the main agent the complete prompt and a render list, subagents neither', () => {
    const sections: any[] = []
    const contexts: any[] = []
    const listeners = new Map<string, (payload: any) => unknown>()
    const disposers: (() => void)[] = []

    const ctx = {
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
    })

    const agent = (id: string, origin?: 'subagent') => ({
      id,
      session: { header: { origin } },
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

    const created = listeners.get('agent/created')
    expect(created).toBeDefined()
    created!({ agent: agent('s1') })
    created!({ agent: agent('s2', 'subagent') })

    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ name: 'genui:openui', complete: true })
    expect(sections[0].text).toContain('root = Stack(')
    expect(contexts).toHaveLength(1)
    expect(contexts[0].name).toBe('genui:renders')
    expect(contexts[0].text()).toBe('')
  })
})
