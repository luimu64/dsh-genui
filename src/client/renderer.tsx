/**
 * The one row a model answer arrives in.
 *
 * This replaces the built-in `assistant-step` renderer at priority -1 rather than adding a
 * second row: the official Definition keeps publishing the Assistant payload that Turn-tail,
 * the token footer, and the process disclosure read, and only the painting changes.
 */
import type { ReactNode } from 'react'
import { assistantText, observeStep, reasoningText, rowMode, stepKey, type AssistantRowData } from './assistant'

export interface OpenUIRowProps {
  node: { data: AssistantRowData }
}

function Reasoning({ text }: { text: string }): ReactNode {
  if (!text) return null
  return (
    <details className="genui-reasoning">
      <summary>Reasoning</summary>
      <div className="genui-reasoning-body" style={{ whiteSpace: 'pre-wrap' }}>
        {text}
      </div>
    </details>
  )
}

export function OpenUIRow({ node }: OpenUIRowProps): ReactNode {
  const data = node.data
  const live = observeStep(stepKey(data), data.status)
  const text = assistantText(data.blocks)
  const mode = rowMode(data, text, live)

  if (mode === 'empty') return null

  return (
    <div className="genui-row" data-genui-step={stepKey(data)}>
      <Reasoning text={reasoningText(data.blocks)} />
      {mode === 'building' ? <div className="genui-building">Building interface…</div> : null}
      {mode === 'partial' || mode === 'text' ? (
        <div className="genui-fallback" style={{ whiteSpace: 'pre-wrap' }}>
          {text}
        </div>
      ) : null}
      {mode === 'program' ? <pre className="genui-program-raw">{text}</pre> : null}
    </div>
  )
}
