/**
 * The frame-source registry: how a progressive image set reaches the renderer without the
 * renderer knowing what made the frames.
 */
import { describe, expect, test } from 'bun:test'
import { batchColumns, currentFrameSource, registerFrameSource } from '../src/client/frames'

describe('batchColumns', () => {
  test('keeps every row but the last full', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(batchColumns)).toEqual([1, 2, 3, 2, 3, 3, 4, 4])
  })
})

describe('a frame source', () => {
  const source = {
    keyOf: (urls: unknown) => {
      const first = Array.isArray(urls) ? urls[0] : null
      return first && typeof first === 'object' ? 'batch-1' : null
    },
    subscribe: () => () => {},
    version: () => 3,
    slots: () => [{ url: '/pic.png', prompt: 'a picture' }],
  }

  test('is absent until a companion registers one', () => {
    expect(currentFrameSource()).toBeNull()
  })

  test('answers key, version and slots while registered, and is gone after', () => {
    const remove = registerFrameSource(source)
    expect(currentFrameSource()?.keyOf([{ url: '' }])).toBe('batch-1')
    expect(currentFrameSource()?.version('batch-1')).toBe(3)
    expect(currentFrameSource()?.slots('batch-1')).toEqual([{ url: '/pic.png', prompt: 'a picture' }])
    remove()
    expect(currentFrameSource()).toBeNull()
  })

  test('disposing an older source does not remove a newer one', () => {
    const first = registerFrameSource(source)
    const second = registerFrameSource({ ...source, version: () => 9 })
    first()
    expect(currentFrameSource()?.version('batch-1')).toBe(9)
    second()
    expect(currentFrameSource()).toBeNull()
  })
})
