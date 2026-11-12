import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { COMPONENT_HEADING, NO_TOOLS, componentCatalogue, fillAnchor, openuiPrompt } from '../src/host/prompt'
import { createGenuiHostService } from '../src/host/registry'

const rules = () => readFileSync(new URL('../assets/prompt-rules.md', import.meta.url), 'utf8').trimEnd()

describe('the committed prompt', () => {
  test('reads the committed assets', () => {
    const text = openuiPrompt()
    expect(text.length).toBeGreaterThan(8_000)
    expect(text).toContain('root = Stack(')
  })

  test('is written to sit beside the harness prompt, not instead of it', () => {
    const text = openuiPrompt()
    expect(text.startsWith('## Answer format')).toBe(true)
    // The old opening claimed the entire system prompt; that breaks as an additive section.
    expect(text).not.toContain('Your ENTIRE response must be valid openui-lang code')
    expect(text).toContain('only the final assistant message of a turn is a program')
    expect(text).toContain('## Using the components')
  })

  test('ends with the rules asset, so a regeneration cannot silently drop them', () => {
    // Only the companion anchor inside the asset is resolved; the text around it is verbatim.
    const resolved = fillAnchor(rules(), '<!-- genui:rules -->', [])
    expect(openuiPrompt().trimEnd().endsWith(resolved)).toBe(true)
    expect(resolved).toContain('## Using the components')
  })

  test('carries no absolute path from the machine that generated it', () => {
    expect(openuiPrompt()).not.toContain('/home/')
  })

  test('names the two web tools the harness exposes, and no image tool', () => {
    const text = openuiPrompt()
    expect(text).toContain('web_search(queries: string[])')
    expect(text).toContain('web_fetch(url: string)')
    // Generation is a companion's business: nothing here may promise it.
    expect(text).not.toContain('generate_image')
    expect(text).not.toContain('edit_image')
    expect(text).not.toContain('ComfyUI')
  })
})

describe('the anchors', () => {
  test('an empty tool catalogue says so instead of promising one', () => {
    const text = openuiPrompt()
    expect(text).toContain(NO_TOOLS)
  })

  test('a registered tool block replaces the fallback, in place', () => {
    const service = createGenuiHostService()
    service.addPromptBlock({
      id: 'probe',
      anchor: 'tools',
      text: () => '- probe_tool(query: string) → {rows: any[]}\n  Reads something.',
    })
    const text = openuiPrompt(service)
    expect(text).toContain('- probe_tool(query: string)')
    expect(text).not.toContain(NO_TOOLS)
    // Inside "Available Tools", before the section that follows it.
    const toolsAt = text.indexOf('## Available Tools')
    const probeAt = text.indexOf('- probe_tool(')
    const nextSection = text.indexOf('## Hoisting & Streaming')
    expect(probeAt).toBeGreaterThan(toolsAt)
    expect(probeAt).toBeLessThan(nextSection)
  })

  test('examples append to the committed ones rather than replacing them', () => {
    const service = createGenuiHostService()
    service.addPromptBlock({ id: 'ex', anchor: 'examples', text: () => 'root = Stack([only_mine])' })
    const text = openuiPrompt(service)
    expect(text).toContain('The build is green')
    expect(text).toContain('root = Stack([only_mine])')
    expect(text.indexOf('The build is green')).toBeLessThan(text.indexOf('root = Stack([only_mine])'))
  })

  test('rules land between the harness rules, not after them', () => {
    const service = createGenuiHostService()
    service.addPromptBlock({ id: 'r', anchor: 'rules', text: () => '### A companion rule' })
    const text = openuiPrompt(service)
    const webAt = text.indexOf('### Web')
    const mineAt = text.indexOf('### A companion rule')
    const styleAt = text.indexOf('### Style')
    expect(mineAt).toBeGreaterThan(webAt)
    expect(mineAt).toBeLessThan(styleAt)
  })

  test('append blocks sit between the language and the rules', () => {
    const service = createGenuiHostService()
    service.addPromptBlock({ id: 'w', anchor: 'append', text: () => '### Optional workflow: probe' })
    const text = openuiPrompt(service)
    const appendAt = text.indexOf('### Optional workflow: probe')
    expect(appendAt).toBeGreaterThan(text.indexOf('## Final Verification'))
    expect(appendAt).toBeLessThan(text.indexOf('## Using the components'))
  })

  test('reads the blocks per call, so a live write reaches the next answer', () => {
    let current = ''
    const service = createGenuiHostService()
    service.addPromptBlock({ id: 'live', anchor: 'tools', text: () => current })
    expect(openuiPrompt(service)).toContain(NO_TOOLS)
    current = '- live_tool()'
    expect(openuiPrompt(service)).toContain('- live_tool()')
  })
})

describe('components a bundle adds', () => {
  const star = {
    name: 'StarRating',
    signature: 'StarRating(label: string, value?: number, max?: number)',
    description: 'Five stars for a quick rating. Use it when the reader wants a score, not a table.',
  }

  test('nothing registered leaves no heading and no marker', () => {
    const text = openuiPrompt()
    expect(text).not.toContain(COMPONENT_HEADING)
    expect(text).not.toContain('genui:components')
  })

  test('a registered component lands in the catalogue, like a shipped one', () => {
    const service = createGenuiHostService()
    service.addComponents([star])
    const text = openuiPrompt(service)
    expect(text).toContain(COMPONENT_HEADING)
    expect(text).toContain(
      'StarRating(label: string, value?: number, max?: number) — Five stars for a quick rating.',
    )
    // Inside "Component Signatures", after the shipped catalogue and before the functions.
    const lastShipped = text.indexOf('GenImageSet(urls: string[]')
    const mineAt = text.indexOf('StarRating(label: string')
    const functionsAt = text.indexOf('## Built-in Functions')
    expect(mineAt).toBeGreaterThan(lastShipped)
    expect(mineAt).toBeLessThan(functionsAt)
    expect(text).not.toContain('genui:components')
  })

  test('the catalogue is empty when nothing registered, never a bare heading', () => {
    expect(componentCatalogue([])).toBe('')
  })

  test('withdrawing the registration takes the line away again', () => {
    const service = createGenuiHostService()
    const remove = service.addComponents([star])
    expect(openuiPrompt(service)).toContain('StarRating(')
    remove()
    expect(openuiPrompt(service)).not.toContain('StarRating')
  })
})

describe('fillAnchor', () => {
  test('replaces the marker with the blocks, one paragraph break either side', () => {
    expect(fillAnchor('a\n\n<!-- x -->\n\nb', '<!-- x -->', ['one', 'two'])).toBe('a\n\none\n\ntwo\n\nb')
  })

  test('leaves the fallback when nothing registered', () => {
    expect(fillAnchor('a\n\n<!-- x -->\n\nb', '<!-- x -->', [], 'nothing')).toBe('a\n\nnothing\n\nb')
  })

  test('an empty anchor with no fallback leaves no hole behind', () => {
    expect(fillAnchor('a\n\n<!-- x -->\n\nb', '<!-- x -->', [])).toBe('a\n\nb')
  })

  test('an asset without the marker is returned untouched', () => {
    expect(fillAnchor('plain', '<!-- x -->', ['one'], 'nothing')).toBe('plain')
  })
})
