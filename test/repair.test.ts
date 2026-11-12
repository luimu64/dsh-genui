/**
 * Repairs applied to a stored program at render time.
 *
 * The case that motivated the name table: `MarkDownRenderer` ships with an interior capital
 * the English word does not have, a model writes `MarkdownRenderer`, and the answer loses its
 * whole prose to an "unknown component" panel. These tests pin the rename, the identity that
 * keeps an already-valid program byte-for-byte unchanged, and the guard that stops a member
 * access from being renamed into a symbol the program never defined.
 */
import { describe, expect, test } from 'bun:test'
import { openuiLibrary } from '@openuidev/react-ui'
import { COMPONENT_ALIASES, repairProgram } from '../src/client/repair'

const TYPO = [
  'root = Stack([md, note])',
  'md = MarkdownRenderer("**Heads up:** the default frame is 3:2.")',
  'note = TextContent("done")',
].join('\n')

describe('component name aliases', () => {
  test('every alias names a component this library actually has', () => {
    for (const [typo, canonical] of Object.entries(COMPONENT_ALIASES)) {
      expect(typo).not.toBe(canonical)
      expect(openuiLibrary.components[canonical]).toBeDefined()
      // An alias for a name the library also ships would shadow a real component.
      expect(openuiLibrary.components[typo]).toBeUndefined()
    }
  })

  test('the misspelled renderer is renamed and keeps its text', () => {
    const repaired = repairProgram(TYPO)
    expect(repaired).toContain('md = MarkDownRenderer("**Heads up:** the default frame is 3:2.")')
    expect(repaired).not.toContain('MarkdownRenderer')
    // Everything else has to survive: a rename is not a licence to rewrite arguments.
    expect(repaired).toContain('note = TextContent("done")')
    expect(repaired.split('\n')[0]).toBe('root = Stack([md, note])')
  })

  test('a program with no alias comes back byte-identical', () => {
    const clean = ['root = Stack([md])', 'md = MarkDownRenderer("hi")'].join('\n')
    expect(repairProgram(clean)).toBe(clean)
  })

  test('a member access is a value, not a component, and is left alone', () => {
    const member = ['root = Stack([t])', 't = TextContent(state.markdownRenderer("x"))'].join('\n')
    expect(repairProgram(member)).toBe(member)
  })
})

/**
 * The one-line answer: a component call with nothing binding it to the entry point.
 *
 * This is the shape the prompt asks for in a short reply, and it used to arrive as an empty
 * row when the model left the `root =` off - or as raw source, because the row's gate did not
 * even offer it to the renderer. The repair is the missing statement, and only that.
 */
describe('a one-line answer', () => {
  test('a bare call gets the root statement it was missing', () => {
    expect(repairProgram('TextContent("Two. One to inherit the smug face.")')).toBe(
      'root = TextContent("Two. One to inherit the smug face.")',
    )
  })

  test('a call that already has a root is left alone', () => {
    const clean = 'root = TextContent("hi")'
    expect(repairProgram(clean)).toBe(clean)
  })

  test('prose that opens a bracket is not a call', () => {
    const prose = 'Two kids (and a dog).'
    expect(repairProgram(prose)).toBe(prose)
  })

  test('two calls are more than one call, and keep their own meaning', () => {
    const longer = 'TextContent("a")\nTextContent("b")'
    expect(repairProgram(longer)).toBe(longer)
  })
})
