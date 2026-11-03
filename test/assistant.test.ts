import { beforeEach, describe, expect, test } from 'bun:test'
import {
  assistantText,
  looksLikeOpenUI,
  observeStep,
  reasoningText,
  resetLiveSteps,
  rowMode,
  stepKey,
  type AssistantRowData,
} from '../src/client/assistant'

const text = (value: string) => ({ kind: 'text' as const, text: value })

beforeEach(() => resetLiveSteps())

describe('assistantText', () => {
  test('joins text blocks and ignores the rest', () => {
    expect(
      assistantText([
        { kind: 'reasoning', text: 'thinking' },
        text('root = '),
        text('Text("hi")'),
        { kind: 'tool-call', callId: 'c1', name: 'bash', argsRaw: '{}' },
        { kind: 'other', block: null },
      ]),
    ).toBe('root = Text("hi")')
  })

  test('is empty for a reply with no text yet', () => {
    expect(assistantText([{ kind: 'reasoning', text: 'x' }])).toBe('')
  })
})

describe('reasoningText', () => {
  test('keeps reasoning blocks and drops blanks', () => {
    expect(reasoningText([{ kind: 'reasoning', text: ' a ' }, text('b'), { kind: 'reasoning', text: '  ' }])).toBe('a')
  })
})

describe('looksLikeOpenUI', () => {
  test('a program starts with root =', () => {
    expect(looksLikeOpenUI('root = Stack([])')).toBe(true)
    expect(looksLikeOpenUI('  \nroot = Text("hi")')).toBe(true)
    expect(looksLikeOpenUI('card = Card([root])\nroot = Stack([card])')).toBe(true)
  })

  test('prose does not', () => {
    expect(looksLikeOpenUI('Here is a normal answer.')).toBe(false)
    expect(looksLikeOpenUI('Root cause is the parser.')).toBe(false)
  })
})

describe('stepKey', () => {
  test('is turn:step', () => {
    expect(stepKey({ turn: 3, step: 1 })).toBe('3:1')
  })
})

describe('live tracking', () => {
  test('a step seen running is live from then on, including once settled', () => {
    const key = stepKey({ turn: 1, step: 0 })
    expect(observeStep(key, 'running')).toBe(true)
    expect(observeStep(key, 'settled')).toBe(true)
  })

  test('a step first painted settled is history', () => {
    expect(observeStep('2:0', 'settled')).toBe(false)
    expect(observeStep('2:0', 'interrupted')).toBe(false)
  })

  test('one step streaming does not make another live', () => {
    observeStep('1:0', 'running')
    expect(observeStep('1:1', 'settled')).toBe(false)
  })
})

describe('rowMode', () => {
  const data = (status: AssistantRowData['status']) => ({ status })

  test('a live step streams behind a placeholder, never a half program', () => {
    expect(rowMode(data('running'), 'root = Stack([', true)).toBe('building')
    expect(rowMode(data('running'), '', true)).toBe('building')
  })

  test('a frozen prefix from the log is text, not an endless shimmer', () => {
    expect(rowMode(data('running'), 'root = Stack([', false)).toBe('partial')
    expect(rowMode(data('running'), '', false)).toBe('empty')
  })

  test('a settled answer is a program only when it looks like one', () => {
    expect(rowMode(data('settled'), 'root = Text("hi")', true)).toBe('program')
    expect(rowMode(data('settled'), 'Here is the answer.', true)).toBe('text')
    expect(rowMode(data('interrupted'), 'root = Text("hi")', false)).toBe('program')
  })

  test('an empty settled answer paints nothing', () => {
    expect(rowMode(data('settled'), '   ', false)).toBe('empty')
  })
})
