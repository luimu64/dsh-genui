import { describe, expect, test } from 'bun:test'
import { Config } from '../src/host/config'

/** Schemastery schemas are callable resolvers; the type says "give me a whole Config". */
const resolve = (input: object): Record<string, unknown> =>
  (Config as unknown as (value: object) => Record<string, unknown>)(input)

describe('Config schema', () => {
  test('answers as an interface by default', () => {
    const defaultOn = resolve({}).defaultOn as unknown as { get(): boolean }
    expect(defaultOn.get()).toBe(true)
  })

  test('the answer format default can be switched off', () => {
    const defaultOn = resolve({ defaultOn: false }).defaultOn as unknown as { get(): boolean }
    expect(defaultOn.get()).toBe(false)
  })

  test('defaultOn is volatile, so a settings row writes it without a restart', () => {
    // A volatile field resolves to a live reference, not to a boolean copy: the host reads
    // it per answer, which is what makes the switch land on the next answer.
    const field = resolve({}).defaultOn as unknown as { get?: unknown }
    expect(typeof field.get).toBe('function')
  })

  test('carries no key that belongs to an optional companion', () => {
    // Image generation (ComfyUI, workflows, an images directory) is a separate bundle with
    // its own config entry. A renderer config that still names them is the split leaking.
    expect(Object.keys(resolve({}))).toEqual(['defaultOn'])
  })
})
