/**
 * The assistant-row contract read straight off the official Assistant data.
 *
 * This bundle paints the `assistant-step` row itself (priority -1) instead of claiming the
 * assistant events with an exclusive Definition. The reason is visible in the installed
 * client: Turn-tail's copy/fork/usage banner is built from the *business* Assistant payload
 * (`FinalAssistantChatData.finalNode`), and an exclusive claim on `assistant/message` is what
 * would stop the built-in Definition from ever publishing it. Painting keeps every built-in
 * projection intact; only the pixels change.
 */
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** The one row the model's answer arrives in. */
export interface AssistantRowData {
  status: 'running' | 'settled' | 'interrupted'
  turn: number
  step: number
  blocks: readonly AssistantBlock[]
}

/**
 * Steps that streamed in this page session. A step observed running at least once is being
 * produced now; a step that is already settled the first time it is painted came out of the
 * session log, and replay must not queue ComfyUI for it.
 *
 * The fallback is the retry control on a missing frame, exactly as for a provider that never
 * streams: a turn that is wrongly judged historical costs one click, never a silent re-render.
 */
const liveSteps = new Set<string>()

export function stepKey(data: Pick<AssistantRowData, 'turn' | 'step'>): string {
  return `${data.turn}:${data.step}`
}

/** Observe one paint and report whether this step has streamed in this page session. */
export function observeStep(key: string, status: AssistantRowData['status']): boolean {
  if (status === 'running') liveSteps.add(key)
  return liveSteps.has(key)
}

/**
 * Whether this row is the last answer in the conversation — the turn the user is looking at.
 *
 * Read off the DOM rather than from React state: every row carries `data-genui-step`, and the
 * newest answer is the last one, so a query fired by a fresh turn can ask "am I the tail?" and
 * get a truthful answer without a second render pass to discover the highest turn.
 *
 * This is the fallback `liveSteps` cannot provide. A provider that publishes an assistant step
 * already `settled` never paints `running`, so a genuinely new turn was judged historical and
 * the gate starved it: the query returned `missing` before any request, and the reader got a
 * hole with a retry button instead of a picture. Earlier turns stay inert, and a cache hit
 * still costs no GPU time.
 */
export function isTailStep(key: string): boolean {
  if (typeof document === 'undefined') return false
  const rows = document.querySelectorAll('[data-genui-step]')
  const last = rows[rows.length - 1]
  return last !== undefined && last.getAttribute('data-genui-step') === key
}

/** Test seam: forget what this page session has seen stream. */
export function resetLiveSteps(): void {
  liveSteps.clear()
}

export function assistantText(blocks: readonly AssistantBlock[]): string {
  return blocks
    .filter((block): block is Extract<AssistantBlock, { kind: 'text' }> => block.kind === 'text')
    .map((block) => block.text)
    .join('')
}

export function reasoningText(blocks: readonly AssistantBlock[]): string {
  return blocks
    .filter((block): block is Extract<AssistantBlock, { kind: 'reasoning' }> => block.kind === 'reasoning')
    .map((block) => block.text.trim())
    .filter((text) => text.length > 0)
    .join('\n\n')
}

/** One openui-lang statement: `root = ...` or `name = ...`. */
const STATEMENT = /^\s*(?:root|[A-Za-z_$][\w$]*)\s*=/

/**
 * The program inside an answer, with the wrappers a model adds anyway removed: a markdown
 * fence around it, or a sentence of introduction above it. A fence body is preferred when it
 * holds the program, because that is where the model put it; otherwise the answer is cut at
 * its first statement line.
 *
 * This is why a fenced program no longer reaches the parser as ```openui … ``` and dies.
 */
export function programText(text: string): string {
  const fenced = /```[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/.exec(text)
  if (fenced && STATEMENT.test(fenced[1].trim())) return fenced[1].trim()

  const lines = text.split('\n')
  const start = lines.findIndex((line) => /^\s*root\s*=/.test(line) || STATEMENT.test(line))
  if (start <= 0) return text.trim()
  return lines.slice(start).join('\n').trim()
}

/** Does this answer look like an openui-lang program rather than prose? */
export function looksLikeOpenUI(text: string): boolean {
  return /^\s*root\s*=/m.test(programText(text))
}

export type RowMode = 'building' | 'partial' | 'program' | 'text' | 'empty' | 'none'

/** Has the answer started looking like a program yet? Used only to pick the placeholder. */
export function programStarted(text: string): boolean {
  return /^\s*(?:root|[A-Za-z_$][\w$]*)\s*=/.test(text.trimStart())
}

/**
 * What the row paints:
 * - `none`: the step is running and has produced no text yet (reasoning only).
 * - `building`: the live step has begun writing a program, which cannot be parsed until it
 *   is finished.
 * - `partial`: text is streaming (or a turn was frozen mid-stream) and is not a program, so
 *   it is rendered as markdown.
 * - `program`: a settled answer to hand to the OpenUI renderer.
 * - `text`: a settled answer that is not a program. Never blank an answer.
 * - `empty`: nothing to say; the row renders nothing rather than an empty frame.
 */
export function rowMode(data: Pick<AssistantRowData, 'status'>, text: string, live: boolean): RowMode {
  const trimmed = text.trim()
  if (data.status === 'running') {
    // Nothing written yet — reasoning only. There is no interface to build, and a permanent
    // "Building interface…" bar through every reasoning phase is noise, so paint nothing and
    // let the reasoning row speak for itself.
    if (trimmed === '') return 'none'
    // A program is being written: parsing it now would only produce errors, so shimmer.
    if (live && programStarted(trimmed)) return 'building'
    // Prose is being written (mode off, or a model that ignored the format): stream it as
    // markdown the way the harness normally does.
    return 'partial'
  }
  if (trimmed === '') return 'empty'
  return looksLikeOpenUI(text) ? 'program' : 'text'
}
