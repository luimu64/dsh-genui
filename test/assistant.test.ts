import { beforeEach, describe, expect, test } from 'bun:test'
import {
  assistantText,
  looksLikeOpenUI,
  programStarted,
  programText,
  observeStep,
  reasoningText,
  resetLiveSteps,
  isTailStep,
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

describe('programText', () => {
  test('leaves a bare program alone', () => {
    expect(programText('root = Stack([])')).toBe('root = Stack([])')
  })

  test('unwraps a fenced program', () => {
    expect(programText('```openui\nroot = Stack([])\n```')).toBe('root = Stack([])')
    expect(programText('```\nroot = Stack([])\n```')).toBe('root = Stack([])')
  })

  test('drops an introduction above the program', () => {
    expect(programText('Here is the comparison you asked for:\n\nroot = Stack([])')).toBe('root = Stack([])')
  })

  test('keeps helper statements that come before root', () => {
    expect(programText('card = Card([])\nroot = Stack([card])')).toBe('card = Card([])\nroot = Stack([card])')
  })

  test('does not turn prose or unrelated code into a program', () => {
    expect(programText('Here is a normal answer.')).toBe('Here is a normal answer.')
    expect(looksLikeOpenUI('```js\nconst x = 1\n```')).toBe(false)
  })

  test('a fenced program is recognised', () => {
    expect(looksLikeOpenUI('```openui\nroot = Stack([])\n```')).toBe(true)
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

describe('isTailStep', () => {
  const fakeRows = (keys: string[]) => {
    ;(globalThis as any).document = {
      querySelectorAll: () =>
        keys.map((key) => ({
          getAttribute: (name: string) => (name === 'data-genui-step' ? key : null),
        })),
    }
  }

  test('the last answer in the conversation is the tail', () => {
    fakeRows(['1:0', '2:0', '3:0'])
    expect(isTailStep('3:0')).toBe(true)
  })

  test('an earlier answer is not, even when its picture is gone', () => {
    fakeRows(['1:0', '2:0', '3:0'])
    expect(isTailStep('2:0')).toBe(false)
  })

  test('no rows mounted is not the tail', () => {
    fakeRows([])
    expect(isTailStep('1:0')).toBe(false)
    delete (globalThis as any).document
    expect(isTailStep('1:0')).toBe(false)
  })
})

describe('rowMode', () => {
  const data = (status: AssistantRowData['status']) => ({ status })

  test('a live program streams behind a placeholder, never a half program', () => {
    expect(rowMode(data('running'), 'root = Stack([', true)).toBe('building')
    expect(rowMode(data('running'), 'card = Card([])', true)).toBe('building')
  })

  test('reasoning alone paints nothing instead of an endless building bar', () => {
    expect(rowMode(data('running'), '', true)).toBe('none')
    expect(rowMode(data('running'), '   \n ', true)).toBe('none')
    expect(rowMode(data('running'), '', false)).toBe('none')
  })

  test('a prose stream is markdown, not a program placeholder', () => {
    expect(rowMode(data('running'), 'Here is the comparison', true)).toBe('partial')
    expect(rowMode(data('running'), 'root = Stack([', false)).toBe('partial')
  })

  test('a settled answer is a program only when it looks like one', () => {
    expect(rowMode(data('settled'), 'root = Text("hi")', true)).toBe('program')
    expect(rowMode(data('settled'), 'Here is the answer.', true)).toBe('text')
    expect(rowMode(data('interrupted'), 'root = Text("hi")', false)).toBe('program')
  })

  test('an empty settled answer paints nothing', () => {
    expect(rowMode(data('settled'), '   ', false)).toBe('empty')
  })

  test('programStarted only fires once a statement has begun', () => {
    expect(programStarted('root = Stack([])')).toBe(true)
    expect(programStarted('ro')).toBe(false)
    expect(programStarted('Here is a table:')).toBe(false)
  })
})
