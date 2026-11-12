/**
 * The component registry: what a companion hands the renderer, and what the renderer must
 * refuse.
 *
 * The library is *derived*, not mutated, because the renderer memoizes a parser by library
 * identity. These tests pin that: identical while nothing changes, a new object after a
 * registration, and back to the shipped one when the contribution goes away.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { defineComponent } from '@openuidev/react-lang'
import { openuiLibrary } from '@openuidev/react-ui'
import { z } from 'zod/v4'
import {
  componentLibrary,
  componentVersion,
  registerComponents,
  registeredComponentNames,
  subscribeComponents,
} from '../src/client/components'

const strips: (() => void)[] = []
function register(entries: Parameters<typeof registerComponents>[0]): void {
  strips.push(registerComponents(entries))
}
afterEach(() => {
  while (strips.length) strips.pop()!()
})

const star = defineComponent({
  name: 'StarRating',
  description: 'Five stars',
  props: z.object({ label: z.string(), value: z.number().optional() }),
  component: () => null,
})

describe('the library', () => {
  test('is the shipped one while nothing is registered', () => {
    expect(componentLibrary()).toBe(openuiLibrary as never)
    expect(registeredComponentNames()).toEqual([])
  })

  test('a contribution joins it, in the slots it names', () => {
    register([{ component: star, slots: ['Card.children'] }])
    const library = componentLibrary()
    expect(library.components.StarRating).toBeDefined()
    expect(library.components.StarRating.name).toBe('StarRating')
    // The shipped components are still there: a contribution adds, it does not replace.
    expect(library.components.Card).toBeDefined()
    expect(registeredComponentNames()).toEqual(['StarRating'])
  })

  test('is cached until something changes, then is a new object', () => {
    const before = componentLibrary()
    expect(componentLibrary()).toBe(before)

    const version = componentVersion()
    register([{ component: star, slots: ['Card.children'] }])
    expect(componentVersion()).toBe(version + 1)
    expect(componentLibrary()).not.toBe(before)
    expect(componentLibrary().components.StarRating).toBeDefined()
  })

  test('returns to the shipped library when the contribution is withdrawn', () => {
    const remove = registerComponents([{ component: star, slots: ['Card.children'] }])
    expect(componentLibrary().components.StarRating).toBeDefined()
    remove()
    expect(componentLibrary().components.StarRating).toBeUndefined()
  })

  test('notifies subscribers, once per change', () => {
    let calls = 0
    const stop = subscribeComponents(() => void (calls += 1))
    register([{ component: star, slots: ['Card.children'] }])
    expect(calls).toBe(1)
    stop()
    strips.pop()!()
    expect(calls).toBe(1)
  })
})

describe('a registration that would not build', () => {
  test('is refused at load, and leaves the library exactly as it was', () => {
    const before = componentLibrary()
    expect(() =>
      registerComponents([
        { component: star, slots: ['Stack.children'] }, // Stack has no content slot
      ]),
    ).toThrow('cannot add StarRating')
    expect(componentLibrary()).toBe(before)
    expect(componentLibrary().components.StarRating).toBeUndefined()
  })
})

describe('names', () => {
  test('a shipped component cannot be shadowed by accident', () => {
    expect(() => register([{ component: star, override: false }])).not.toThrow()
    const notDefined = defineComponent({
      name: 'ImageBlock',
      description: 'not the shipped one',
      props: z.object({ src: z.string() }),
      component: () => null,
    })
    expect(() => registerComponents([{ component: notDefined }])).toThrow('shipped component')
  })

  test('an explicit override re-points the shipped component', () => {
    const replacement = defineComponent({
      name: 'ImageBlock',
      description: 'the shipped one, painted differently',
      props: z.object({ src: z.string(), alt: z.string().optional() }),
      component: () => null,
    })
    register([{ component: replacement, override: true }])
    expect(componentLibrary().components.ImageBlock).not.toBe(openuiLibrary.components.ImageBlock)
  })

  test('a later registration of the same name wins, and its own disposer is what removes it', () => {
    const first = registerComponents([{ component: star, slots: ['Card.children'] }])
    const second = registerComponents([{ component: star, slots: ['Card.children'] }])
    // The older registration must not take the newer one away.
    first()
    expect(componentLibrary().components.StarRating).toBeDefined()
    second()
    expect(componentLibrary().components.StarRating).toBeUndefined()
  })
})
