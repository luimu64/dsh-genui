/**
 * A click has to arrive somewhere.
 *
 * OpenUI hands every action prop to the renderer's `onAction`; `Run`/`Set`/`Reset` never get
 * there, so anything this file tests is what a reader's click finally does. It was all inert
 * while the bundle passed no callback, which is the regression these cases lock down.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  actionMessage,
  runAction,
  setAnswerActions,
  type AnswerActions,
  type ComposerInput,
} from '../src/client/actions'

const sent: { sessionId: string; text: string }[] = []
const opened: string[] = []

const bridge: AnswerActions = {
  send(sessionId, text) {
    sent.push({ sessionId, text })
    return true
  },
  open(url) {
    opened.push(url)
  },
}

const composer = (): ComposerInput & { drafts: string[]; submits: number } => {
  const state = {
    drafts: [] as string[],
    submits: 0,
    setDraft(text: string) {
      state.drafts.push(text)
    },
    submit() {
      state.submits += 1
    },
  }
  return state
}

beforeEach(() => {
  sent.length = 0
  opened.length = 0
  setAnswerActions(bridge)
})

afterEach(() => setAnswerActions(null))

describe('runAction', () => {
  test('sends a @ToAssistant message into the row’s session', () => {
    expect(
      runAction(
        { type: 'continue_conversation', humanFriendlyMessage: 'Tell me more' },
        's1',
        composer(),
      ),
    ).toBe(true)
    expect(sent).toEqual([{ sessionId: 's1', text: 'Tell me more' }])
  })

  test('a Button with no action sends its own label', () => {
    // The renderer reports a bare click as ContinueConversation carrying the label, which is
    // how the documented "a button without an action sends its label" rule reaches a session.
    runAction({ type: 'continue_conversation', humanFriendlyMessage: 'Refresh' }, 's1')
    expect(sent[0].text).toBe('Refresh')
  })

  test('carries the hidden context and form state it was given', () => {
    const message = actionMessage({
      type: 'continue_conversation',
      humanFriendlyMessage: 'Show details',
      params: { context: { orderId: 42 } },
      formState: { contact: { name: { value: 'Ada', componentType: 'Input' } } },
    })
    expect(message).toContain('Show details')
    expect(message).toContain('"orderId": 42')
    expect(message).toContain('"Ada"')
  })

  test('ignores a click that carries nothing', () => {
    expect(runAction({ type: 'continue_conversation', humanFriendlyMessage: '   ' }, 's1')).toBe(false)
    expect(sent).toHaveLength(0)
  })

  test('opens an HTTP(S) link through the shell', () => {
    expect(runAction({ type: 'open_url', params: { url: 'https://example.com/a' } }, 's1')).toBe(true)
    expect(opened).toEqual(['https://example.com/a'])
    expect(sent).toHaveLength(0)
  })

  test('refuses a URL scheme it will not hand to the browser', () => {
    expect(runAction({ type: 'open_url', params: { url: 'javascript:alert(1)' } }, 's1')).toBe(false)
    expect(opened).toHaveLength(0)
  })
})

describe('delivery without a session scope', () => {
  test('falls back to the composer when no scope is reachable', () => {
    setAnswerActions({
      send: () => false,
      open: bridge.open,
    })
    const draft = composer()
    expect(
      runAction({ type: 'continue_conversation', humanFriendlyMessage: 'Again' }, 's1', draft),
    ).toBe(true)
    expect(draft.drafts).toEqual(['Again'])
    expect(draft.submits).toBe(1)
  })

  test('does nothing when neither a scope nor a composer exists', () => {
    setAnswerActions({ send: () => false, open: bridge.open })
    expect(runAction({ type: 'continue_conversation', humanFriendlyMessage: 'Again' })).toBe(false)
  })
})
