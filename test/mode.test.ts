import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModeStore, modeFile, type ModeStore } from '../src/host/mode'
import { modeMessage, parseModeCommand, registerCommands } from '../src/host/commands'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})
async function tempFile() {
  const dir = await mkdtemp(join(tmpdir(), 'genui-mode-'))
  dirs.push(dir)
  return join(dir, 'genui-mode.json')
}

describe('parseModeCommand', () => {
  test('reads on, off and status', () => {
    expect(parseModeCommand('on')).toBe(true)
    expect(parseModeCommand(' OFF ')).toBe(false)
    expect(parseModeCommand('status')).toBe('status')
    expect(parseModeCommand('')).toBe('status')
  })

  test('rejects anything else', () => {
    expect(parseModeCommand('maybe')).toBeUndefined()
    expect(parseModeCommand('on now')).toBeUndefined()
  })
})

describe('modeMessage', () => {
  test('says what the next answer will be, and for whom', () => {
    expect(modeMessage(true)).toContain('next answer')
    expect(modeMessage(true)).toContain('this conversation')
    expect(modeMessage(false)).toContain('markdown')
  })
})

describe('createModeStore', () => {
  test('is off for every conversation until it is turned on', async () => {
    const store = createModeStore(await tempFile())
    expect(store.isOn('s1')).toBe(false)
    expect(store.sessions()).toEqual([])
  })

  test('one conversation being on says nothing about another', async () => {
    const store = createModeStore(await tempFile())
    store.set('s1', true)
    expect(store.isOn('s1')).toBe(true)
    expect(store.isOn('s2')).toBe(false)
  })

  test('persists the set and survives a new store', async () => {
    const file = await tempFile()
    const store = createModeStore(file)
    store.set('s1', true)
    store.set('s2', true)
    store.set('s1', false)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ sessions: ['s2'] })
    expect(createModeStore(file).isOn('s2')).toBe(true)
    expect(createModeStore(file).isOn('s1')).toBe(false)
  })

  test('the old instance-wide shape cannot enable a conversation', async () => {
    const file = await tempFile()
    await writeFile(file, JSON.stringify({ openui: true }))
    expect(createModeStore(file).sessions()).toEqual([])
  })

  test('junk is ignored instead of thrown', async () => {
    const file = await tempFile()
    await writeFile(file, '{not json')
    expect(createModeStore(file).sessions()).toEqual([])
  })

  test('lives under the DSH home', () => {
    expect(modeFile({ DSH_HOME: '/tmp/home' } as NodeJS.ProcessEnv)).toBe('/tmp/home/genui-mode.json')
  })
})

describe('/openui', () => {
  function harness(store: ModeStore, sessionId = 's1') {
    const registered: any[] = []
    const injected: string[][] = []
    const ctx: any = {
      inject: (deps: string[], callback: (scoped: any) => void) => {
        injected.push(deps)
        callback({ commands: { register: (definition: unknown) => registered.push(definition) } })
      },
    }
    registerCommands(ctx, store)
    return {
      injected,
      definition: registered[0],
      invoke: (rawInput: string) =>
        registered[0].handler({ agent: { session: { id: sessionId } }, rawInput }),
    }
  }

  test('registers one command only when the command runtime exists', async () => {
    const store = createModeStore(await tempFile())
    const { injected, definition } = harness(store)
    expect(injected).toEqual([['commands']])
    expect(definition.name).toBe('openui')
  })

  test('toggles only the invoking conversation', async () => {
    const store = createModeStore(await tempFile())
    const { invoke } = harness(store, 's1')
    expect(invoke(' off ')).toEqual({ kind: 'success', text: modeMessage(false) })
    expect(invoke(' on ')).toEqual({ kind: 'success', text: modeMessage(true) })
    expect(store.isOn('s1')).toBe(true)
    expect(store.isOn('s2')).toBe(false)
  })

  test('reports the mode of the conversation it was typed in', async () => {
    const store = createModeStore(await tempFile())
    store.set('s1', true)
    const mine = harness(store, 's1')
    const other = harness(store, 's2')
    expect(mine.invoke('')).toEqual({ kind: 'success', text: modeMessage(true) })
    expect(other.invoke('')).toEqual({ kind: 'success', text: modeMessage(false) })
  })

  test('refuses an unknown word without changing the mode', async () => {
    const store = createModeStore(await tempFile())
    const { invoke } = harness(store)
    expect(invoke('purple').kind).toBe('error')
    expect(store.isOn('s1')).toBe(false)
  })
})
