/**
 * The surface an optional companion contributes to: prompt blocks and one context.
 *
 * The rules worth pinning are the ones that make an uninstall clean: a block is read per
 * assembly, a disposer removes only its own registration, and a block that cannot be read is
 * dropped instead of failing the turn.
 */
import { describe, expect, test } from 'bun:test'
import { createGenuiHostService } from '../src/host/registry'

describe('prompt blocks', () => {
  test('land in their own anchor, in registration order', () => {
    const service = createGenuiHostService()
    service.addPromptBlock({ id: 'b', anchor: 'tools', text: () => 'second' })
    service.addPromptBlock({ id: 'a', anchor: 'tools', text: () => 'first' })
    service.addPromptBlock({ id: 'c', anchor: 'tools', text: () => 'third' })
    service.addPromptBlock({ id: 'x', anchor: 'rules', text: () => 'elsewhere' })
    expect(service.blocks('tools')).toEqual(['second', 'first', 'third'])
    expect(service.blocks('rules')).toEqual(['elsewhere'])
    expect(service.blocks('examples')).toEqual([])
  })

  test('an anchorless block is an append block', () => {
    const service = createGenuiHostService()
    service.addPromptBlock({ id: 'a', text: () => 'tail' })
    expect(service.blocks('append')).toEqual(['tail'])
  })

  test('re-registering an id replaces it instead of stacking it', () => {
    const service = createGenuiHostService()
    service.addPromptBlock({ id: 'same', anchor: 'tools', text: () => 'old' })
    service.addPromptBlock({ id: 'same', anchor: 'tools', text: () => 'new' })
    expect(service.blocks('tools')).toEqual(['new'])
  })

  test('a disposer removes its own registration only', () => {
    const service = createGenuiHostService()
    const first = service.addPromptBlock({ id: 'same', anchor: 'tools', text: () => 'first' })
    service.addPromptBlock({ id: 'same', anchor: 'tools', text: () => 'second' })
    // The older registration's disposer must not take the newer block away.
    first()
    expect(service.blocks('tools')).toEqual(['second'])
  })

  test('blank and unreadable blocks are dropped, never thrown', () => {
    const service = createGenuiHostService()
    service.addPromptBlock({ id: 'blank', anchor: 'tools', text: () => '   ' })
    service.addPromptBlock({
      id: 'broken',
      anchor: 'tools',
      text: () => {
        throw new Error('setting is gone')
      },
    })
    service.addPromptBlock({ id: 'ok', anchor: 'tools', text: () => 'kept' })
    expect(service.blocks('tools')).toEqual(['kept'])
  })
})

describe('components', () => {
  const star = { name: 'StarRating', signature: 'StarRating(value: number)', description: 'Five stars.' }
  const meter = { name: 'Meter', signature: 'Meter(value: number, max: number)', description: 'A bar.' }

  test('are listed in registration order', () => {
    const service = createGenuiHostService()
    service.addComponents([star, meter])
    expect(service.components().map((doc) => doc.name)).toEqual(['StarRating', 'Meter'])
  })

  test('a name registered twice is one entry, the newer one', () => {
    const service = createGenuiHostService()
    service.addComponents([star])
    service.addComponents([{ ...star, description: 'Five stars, again.' }])
    expect(service.components()).toHaveLength(1)
    expect(service.components()[0].description).toBe('Five stars, again.')
  })

  test('the disposer removes its own registration only', () => {
    const service = createGenuiHostService()
    const first = service.addComponents([star])
    service.addComponents([{ ...star, description: 'newer' }])
    first()
    expect(service.components()).toEqual([{ ...star, description: 'newer' }])
  })
})

describe('contexts', () => {
  test('carry an id, because the assembly names each one', () => {
    const service = createGenuiHostService()
    service.addContext('renders', () => '### Renders\n\n- one')
    expect(service.contexts()).toEqual([{ id: 'renders', text: '### Renders\n\n- one' }])
  })

  test('an empty reader is a context that is not there', () => {
    const service = createGenuiHostService()
    service.addContext('renders', () => '')
    expect(service.contexts()).toEqual([])
  })

  test('the disposer removes it, keyed by reader', () => {
    const service = createGenuiHostService()
    const reader = () => 'text'
    const remove = service.addContext('renders', reader)
    remove()
    expect(service.contexts()).toEqual([])
  })
})
