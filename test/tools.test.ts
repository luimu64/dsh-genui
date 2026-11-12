/**
 * The `Query()` tool registry: the join between a rendered answer and whatever a companion
 * bundle serves.
 *
 * The behaviours that matter are about the *turn*: a handler is handed the permission of the
 * answer being painted, so a replayed answer cannot queue work, and about the lookup being
 * live, so a tool registered after the row mounted is still reachable.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { lookupQueryTool, makeToolProvider, queryToolNames, registerQueryTools } from '../src/client/tools'
import type { ReplayAccess } from '../src/client/replay'

const strips: (() => void)[] = []
function register(tools: Record<string, any>): void {
  strips.push(registerQueryTools(tools))
}
afterEach(() => {
  while (strips.length) strips.pop()!()
})

function turn(allowGeneration: boolean, isTail = false): ReplayAccess {
  return { allowGeneration, mayGenerate: () => allowGeneration || isTail, retry: () => {} }
}

describe('the registry', () => {
  test('a registration is visible by name and removed by its disposer', () => {
    const remove = registerQueryTools({ probe: async () => 'ok' })
    expect(queryToolNames()).toEqual(['probe'])
    expect(lookupQueryTool('probe')).toBeDefined()
    remove()
    expect(queryToolNames()).toEqual([])
    expect(lookupQueryTool('probe')).toBeUndefined()
  })
})

describe('the provider', () => {
  test('hands the tool the turn it is being painted for', async () => {
    const seen: unknown[] = []
    register({ probe: async (_args: unknown, access: unknown) => void seen.push(access) })
    await makeToolProvider(turn(false, true)).probe({})
    const access = seen[0] as ReplayAccess
    expect(access.allowGeneration).toBe(false)
    expect(access.mayGenerate()).toBe(true)
  })

  test('an unknown tool is not a function, so the renderer reports the tool it lacks', () => {
    expect(makeToolProvider(turn(true)).generate_image).toBeUndefined()
    expect('generate_image' in makeToolProvider(turn(true))).toBe(false)
  })

  test('a tool registered after the provider was built is still reachable', async () => {
    const provider = makeToolProvider(turn(true))
    register({ late: async () => 'arrived' })
    expect(await provider.late({})).toBe('arrived')
  })

  test('arguments are passed through untouched', async () => {
    const seen: Record<string, unknown>[] = []
    register({ probe: async (args: Record<string, unknown>) => void seen.push(args) })
    await makeToolProvider(turn(true)).probe({ prompt: 'a red fox', count: 2 })
    expect(seen[0]).toEqual({ prompt: 'a red fox', count: 2 })
  })

  test('a rejecting tool rejects the query', async () => {
    register({
      probe: async () => {
        throw new Error('no such lane')
      },
    })
    await expect(makeToolProvider(turn(true)).probe({})).rejects.toThrow('no such lane')
  })

  test('the provider lists the registered tools the way an object does', () => {
    register({ probe: async () => '', other: async () => '' })
    const provider = makeToolProvider(turn(true))
    expect(Object.keys(provider)).toEqual(['probe', 'other'])
  })
})
