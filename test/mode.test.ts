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
  test('says what the next answer will be', () => {
    expect(modeMessage(true)).toContain('on')
    expect(modeMessage(false)).toContain('off')
  })
})

describe('createModeStore', () => {
  test('defaults from config when nothing is stored', async () => {
    const file = await tempFile()
    expect(createModeStore(true, file).enabled()).toBe(true)
    expect(createModeStore(false, file).enabled()).toBe(false)
  })

  test('persists a toggle and survives a new store', async () => {
    const file = await tempFile()
    const store = createModeStore(true, file)
    store.set(false)
    expect(store.enabled()).toBe(false)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ openui: false })
    expect(createModeStore(true, file).enabled()).toBe(false)
  })

  test('a stored flag wins over the config default', async () => {
    const file = await tempFile()
    await writeFile(file, JSON.stringify({ openui: true }))
    expect(createModeStore(false, file).enabled()).toBe(true)
  })

  test('junk is ignored instead of thrown', async () => {
    const file = await tempFile()
    await writeFile(file, '{not json')
    expect(createModeStore(true, file).enabled()).toBe(true)
  })

  test('lives under the DSH home', () => {
    expect(modeFile({ DSH_HOME: '/tmp/home' } as NodeJS.ProcessEnv)).toBe('/tmp/home/genui-mode.json')
  })
})

describe('/openui', () => {
  function harness(store: ModeStore) {
    const registered: any[] = []
    const injected: string[][] = []
    const ctx: any = {
      inject: (deps: string[], callback: (scoped: any) => void) => {
        injected.push(deps)
        callback({ commands: { register: (definition: unknown) => registered.push(definition) } })
      },
    }
    registerCommands(ctx, store)
    return { injected, definition: registered[0] }
  }

  test('registers one command only when the command runtime exists', async () => {
    const store = createModeStore(true, await tempFile())
    const { injected, definition } = harness(store)
    expect(injected).toEqual([['commands']])
    expect(definition.name).toBe('openui')
  })

  test('toggles and reports', async () => {
    const store = createModeStore(true, await tempFile())
    const { definition } = harness(store)
    expect(definition.handler({ rawInput: ' off ' })).toEqual({
      kind: 'success',
      text: modeMessage(false),
    })
    expect(store.enabled()).toBe(false)
    expect(definition.handler({ rawInput: '' })).toEqual({
      kind: 'success',
      text: modeMessage(false),
    })
  })

  test('refuses an unknown word without changing the mode', async () => {
    const store = createModeStore(true, await tempFile())
    const { definition } = harness(store)
    expect(definition.handler({ rawInput: 'purple' }).kind).toBe('error')
    expect(store.enabled()).toBe(true)
  })
})
