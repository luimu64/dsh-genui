import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listRenders, readRender, resolveSource, saveRender, safeImageName } from '../src/host/images'

let dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })))
  dirs = []
})
async function tempDir() {
  const d = await mkdtemp(join(tmpdir(), 'genui-'))
  dirs.push(d)
  return d
}

describe('images', () => {
  test('rejects traversal names', () => {
    expect(() => safeImageName('../secret.png')).toThrow()
    expect(() => safeImageName('a/b.png')).toThrow()
    expect(safeImageName('harness_real_1.png')).toBe('harness_real_1.png')
  })

  test('rejects anything that is not a plain png name', () => {
    expect(() => safeImageName('')).toThrow()
    expect(() => safeImageName('a.png.jpg')).toThrow()
    expect(() => safeImageName('a\\b.png')).toThrow()
    expect(() => safeImageName('/etc/passwd')).toThrow()
    expect(() => safeImageName('..')).toThrow()
    expect(() => safeImageName('.hidden.png')).toThrow()
  })

  test('saves and reads a render', async () => {
    const dir = await tempDir()
    const file = await saveRender(dir, 'harness_real_1.png', new Uint8Array([1, 2, 3]))
    expect(file).toBe('harness_real_1.png')
    expect(await readRender(dir, file)).toEqual(new Uint8Array([1, 2, 3]))
  })

  test('lists newest first synchronously for the prompt', async () => {
    const dir = await tempDir()
    await saveRender(dir, 'older.png', new Uint8Array([1]))
    await new Promise((r) => setTimeout(r, 20))
    await saveRender(dir, 'newer.png', new Uint8Array([2]))
    expect(listRenders(dir, 10)[0].file).toBe('newer.png')
  })

  test('lists an absent directory as empty instead of throwing', () => {
    expect(listRenders('/nonexistent/genui-images', 5)).toEqual([])
  })

  test('resolves a filename or the newest render', async () => {
    const dir = await tempDir()
    await saveRender(dir, 'one.png', new Uint8Array([1]))
    expect(resolveSource(dir)).toBe('one.png')
    expect(resolveSource(dir, 'one.png')).toBe('one.png')
    expect(() => resolveSource(dir, '../one.png')).toThrow()
  })

  test('refuses to resolve a name that is not on disk', async () => {
    const dir = await tempDir()
    expect(() => resolveSource(dir)).toThrow()
    expect(() => resolveSource(dir, 'gone.png')).toThrow()
  })
})
