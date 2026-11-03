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

/** Does this answer look like an openui-lang program rather than prose? */
export function looksLikeOpenUI(text: string): boolean {
  return /^\s*root\s*=/m.test(text)
}

export type RowMode = 'building' | 'partial' | 'program' | 'text' | 'empty'

/**
 * What the row paints:
 * - `building`: the live step has not finished, so its text may still be a half program.
 * - `partial`: a step that never streamed here and never settled — the session log's frozen
 *   prefix of an interrupted turn. It is history, so it must not shimmer forever.
 * - `program`: a settled answer to hand to the OpenUI renderer.
 * - `text`: a settled answer that is not a program. Never blank an answer.
 * - `empty`: nothing to say; the row renders nothing rather than an empty frame.
 */
export function rowMode(data: Pick<AssistantRowData, 'status'>, text: string, live: boolean): RowMode {
  const trimmed = text.trim()
  if (trimmed === '') return data.status === 'running' && live ? 'building' : 'empty'
  if (data.status === 'running') return live ? 'building' : 'partial'
  return looksLikeOpenUI(text) ? 'program' : 'text'
}
