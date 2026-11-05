/**
 * What a click inside a rendered answer is allowed to do.
 *
 * OpenUI hands every action prop in the library — Button, icon buttons, card blocks,
 * follow-ups, list items — to one callback. `Run`, `Set`, and `Reset` steps never leave the
 * renderer; `@ToAssistant`, `@OpenUrl`, legacy actions and custom actions are delivered to
 * `onAction`, and with no `onAction` supplied they were delivered to nobody. That is the
 * whole bug: the control painted, took focus, showed its pressed state, and did nothing.
 *
 * A slot renderer has no Cordis context, only its node, the session id, and the composer's
 * public input actions. The plugin's apply context is the one place that can reach the
 * scope-addressed Conversation service, so it publishes its verbs here at mount
 * (`setAnswerActions`) and this module reads them at click time. Nothing here imports React:
 * the delivery rules are testable on their own.
 */

/** The composer's public input actions, as the session-scoped slot hands them to a row. */
export interface ComposerInput {
  /** Replace the whole draft with plain text, removing inline reference chips. */
  setDraft(text: string): void
  /** Enter submission through the input machine. */
  submit(): void
}

/** The verbs the plugin's apply context lends to a rendered answer. */
export interface AnswerActions {
  /**
   * Send one message into a session.
   * @returns false when that session has no retained scope, so the caller can fall back.
   */
  send(sessionId: string, text: string): boolean
  /** Open one HTTP(S) link at the shell's chosen destination. */
  open(url: string): void
}

/** The slice of an OpenUI action event this module reads. */
export interface ActionEventLike {
  type: string
  params?: Record<string, unknown>
  humanFriendlyMessage?: string
  formState?: Record<string, unknown>
}

const OPEN_URL = 'open_url'

let installed: AnswerActions | null = null

/** Publish (or with null, withdraw) the apply context's verbs. */
export function setAnswerActions(next: AnswerActions | null): void {
  installed = next
}

/** Test seam: is a bridge mounted? */
export function hasAnswerActions(): boolean {
  return installed !== null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as object).length === 0
  return false
}

/**
 * A value the action carried as structured data, rendered so the model can read it.
 *
 * Both are hidden payloads the program attached to a click: the `context` of an
 * `@ToAssistant`, and the raw form state of a submitted `Form`. Sending the label alone
 * would drop everything the reader actually chose.
 */
function payload(value: unknown): string {
  try {
    return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
  } catch {
    return ''
  }
}

/**
 * The message one action sends: its own label, then whatever it carried.
 *
 * @param event - the action event the renderer delivered.
 * @returns the prompt text, or an empty string when the action carries no message.
 */
export function actionMessage(event: ActionEventLike): string {
  const parts: string[] = []
  const message = text(event.humanFriendlyMessage)
  if (message) parts.push(message)

  const context = event.params?.context
  if (!isBlank(context)) {
    const block = payload(context)
    if (block) parts.push(block)
  }

  const form = event.formState
  if (!isBlank(form)) {
    const block = payload(form)
    if (block) parts.push(block)
  }

  return parts.join('\n\n')
}

/**
 * Deliver one message: through the scoped Conversation service when the session is
 * reachable, otherwise through the composer the row was handed.
 *
 * The composer path replaces the draft, which is a real cost, so it is the fallback rather
 * than the route: it exists for a shell that composes no sessions service, and for a
 * session whose scope is already gone.
 */
function deliver(sessionId: string | undefined, message: string, composer?: ComposerInput): boolean {
  if (sessionId && installed?.send(sessionId, message)) return true
  if (!composer) return false
  composer.setDraft(message)
  composer.submit()
  return true
}

/**
 * Run one action event.
 *
 * @param event - the action event the renderer delivered.
 * @param sessionId - the row's session, used for the scoped send.
 * @param composer - the session's public input actions, used when no scope is reachable.
 * @returns whether the click did anything.
 */
export function runAction(
  event: ActionEventLike,
  sessionId?: string,
  composer?: ComposerInput,
): boolean {
  if (event.type === OPEN_URL) {
    const url = text(event.params?.url)
    if (!/^https?:\/\//i.test(url)) return false
    const open =
      installed?.open ??
      ((href: string) => {
        window.open(href, '_blank', 'noopener,noreferrer')
      })
    open(url)
    return true
  }

  // Everything else is a conversation turn: `@ToAssistant`, a bare Button's label, and any
  // custom action this library does not declare. A custom action nobody handles is better
  // sent as a message than swallowed.
  const message = actionMessage(event)
  if (!message) return false
  return deliver(sessionId, message, composer)
}
