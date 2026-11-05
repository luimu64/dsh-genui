/**
 * The host-side render index.
 *
 * The browser's cache is per-profile and per-origin; this map is what makes "the picture is
 * on this machine" true again after that cache is lost. It is only ever a lookup — it never
 * queues anything.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { createRenderIndex, safeKey } from '../src/host/renderIndex'

let dirs: string[] = []

function dir(): string {
  const made = mkdtempSync(join(tmpdir(), 'genui-index-'))
  dirs.push(made)
  return made
}

afterEach(() => {
  for (const made of dirs) rmSync(made, { recursive: true, force: true })
  dirs = []
})

const render = (file: string) => ({
  url: `/genui/images/${file}`,
  file,
  prompt: 'a red fox',
  lane: 'real',
  quality: 'fast',
  seed: 7,
  steps: 4,
  images: [{ url: `/genui/images/${file}`, file }],
})

describe('safeKey', () => {
  test('keeps the browser key, refuses anything that is not a bounded string', () => {
    const key = '["real","a fox","fast",1,832,1216,null,null,null,null,null,1]'
    expect(safeKey(key)).toBe(key)
    expect(safeKey(` ${key} `)).toBe(key)
    expect(safeKey('')).toBeNull()
    expect(safeKey('   ')).toBeNull()
    expect(safeKey(42)).toBeNull()
    expect(safeKey('x'.repeat(4097))).toBeNull()
  })
})

describe('createRenderIndex', () => {
  test('a remembered key is found again after a reload', () => {
    const where = dir()
    const first = createRenderIndex(where)
    first.remember('key-a', render('one.png'))
    expect(first.lookup('key-a')?.url).toBe('/genui/images/one.png')

    // A new process, same folder: the file is the truth, so the map comes back.
    const second = createRenderIndex(where)
    expect(second.lookup('key-a')?.file).toBe('one.png')
  })

  test('an unknown key is a miss, not an error', () => {
    expect(createRenderIndex(dir()).lookup('never rendered')).toBeUndefined()
  })

  test('a corrupt index costs a lookup, never a render', () => {
    const where = dir()
    writeFileSync(join(where, 'index.json'), '{ not json')
    const index = createRenderIndex(where)
    expect(index.lookup('anything')).toBeUndefined()
    index.remember('fresh', render('two.png'))
    expect(index.lookup('fresh')?.file).toBe('two.png')
  })

  test('the oldest entries fall out, the newest stay', () => {
    const index = createRenderIndex(dir())
    for (let i = 0; i < 520; i++) index.remember(`k${i}`, render(`${i}.png`))
    expect(index.size()).toBe(512)
    expect(index.lookup('k0')).toBeUndefined()
    expect(index.lookup('k519')?.file).toBe('519.png')
  })

  test('the same key is replaced, not duplicated', () => {
    const index = createRenderIndex(dir())
    index.remember('same', render('old.png'))
    index.remember('same', render('new.png'))
    expect(index.size()).toBe(1)
    expect(index.lookup('same')?.file).toBe('new.png')
  })

  test('an entry with no url is ignored on load', () => {
    const where = dir()
    writeFileSync(
      join(where, 'index.json'),
      JSON.stringify({ broken: { file: 'x.png' }, good: render('good.png') }),
    )
    const index = createRenderIndex(where)
    expect(index.lookup('broken')).toBeUndefined()
    expect(index.lookup('good')?.file).toBe('good.png')
  })
})
