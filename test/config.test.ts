import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { Config, defaultImagesDir } from '../src/host/config'

/** Schemastery schemas are callable resolvers; the type says "give me a whole Config". */
const resolve = (input: object): Record<string, unknown> =>
  (Config as unknown as (value: object) => Record<string, unknown>)(input)

describe('defaultImagesDir', () => {
  test('lives under the XDG data directory when one is set', () => {
    expect(defaultImagesDir({ XDG_DATA_HOME: '/srv/data' }, '/home/someone')).toBe(
      join('/srv/data', 'dsh-genui', 'images'),
    )
  })

  test('falls back to ~/.local/share, and never to a path from this checkout', () => {
    const dir = defaultImagesDir({}, '/home/someone')
    expect(dir).toBe(join('/home/someone', '.local', 'share', 'dsh-genui', 'images'))
    expect(dir).not.toContain('projects')
  })

  test('an empty or blank override is ignored', () => {
    expect(defaultImagesDir({ XDG_DATA_HOME: '   ' }, '/home/someone')).toBe(
      join('/home/someone', '.local', 'share', 'dsh-genui', 'images'),
    )
  })
})

describe('Config schema', () => {
  test('resolves every key with a usable default', () => {
    const resolved = resolve({})
    expect(resolved.comfyBase).toBe('http://127.0.0.1:8188')
    expect(resolved.maxBatch).toBe(8)
    expect(resolved.pollMs).toBe(750)
    expect(resolved.minPngBytes).toBe(30_000)
    expect(resolved.defaultOn).toBe(true)
    expect(resolved.filePrefix).toBe('genui')
    expect(String(resolved.imagesDir)).toContain('dsh-genui')
  })

  test('takes an explicit file prefix', () => {
    expect(resolve({ filePrefix: 'studio' }).filePrefix).toBe('studio')
  })
})
