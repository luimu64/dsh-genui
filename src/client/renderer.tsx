/**
 * The one row a model answer arrives in.
 *
 * This replaces the built-in `assistant-step` renderer at priority -1 rather than adding a
 * second row: the official Definition keeps publishing the Assistant payload that Turn-tail,
 * the token footer, and the process disclosure read, and only the painting changes. See
 * `docs/client-contract.md` for why the exclusive-Definition design was dropped.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Renderer } from '@openuidev/react-lang'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { genuiLibrary } from './library'
import { makeToolProvider } from './toolProvider'
import { friendlyErrors, repairProgram } from './repair'
import { runAction, type ActionEventLike, type ComposerInput } from './actions'
import { ReplayContext } from './replay'
import { ImageWaitProvider, useImageAnimating } from './pending'
import {
  assistantText,
  isTailStep,
  observeStep,
  programText,
  reasoningText,
  rowMode,
  stepKey,
  type AssistantRowData,
} from './assistant'

export interface OpenUIRowProps {
  node: { data: AssistantRowData }
  /**
   * The same step is routed twice: once inside the turn-process disclosure with
   * `groupPart: "reasoning"`, once as the answer row. Honouring the part is what keeps the
   * answer from being painted inside the disclosure as well — which is exactly how a step
   * looked like it was shown twice and then folded away.
   */
  groupPart?: string
  /** The row's session, from the slot's standard props. */
  sessionId?: string
  /**
   * The session's public input actions, also from the standard props. Only used when the
   * session has no retained scope to send through, so a click still lands.
   */
  inputActions?: ComposerInput
}

/** English chrome for the shell's markdown renderer; the plugin's copy is not localized. */
const MARKDOWN_LABELS: MarkdownLabels = {
  code: { copyLabel: 'Copy', copiedLabel: 'Copied' },
  footnotes: 'Footnotes',
}

/**
 * The renderer's loader for a `Query()` in flight. An image query already paints its own
 * shimmering frame, so a second indicator above it is noise.
 */
function QueryThinking(): ReactNode {
  const animating = useImageAnimating()
  if (animating) return null
  return <div className="genui-loading" role="status" aria-label="Loading" />
}

export function OpenUIRow({ node, groupPart, sessionId, inputActions }: OpenUIRowProps): ReactNode {
  const data = node.data
  const key = stepKey(data)
  // Read once per paint: a step that streamed in this page session may queue ComfyUI, a step
  // that came out of the log may only display what the cache already holds.
  const live = observeStep(key, data.status)
  const text = assistantText(data.blocks)
  const mode = rowMode(data, text, live)

  const [allow, setAllow] = useState(false)
  const [retries, setRetries] = useState(0)
  const [errors, setErrors] = useState('')
  const allowGeneration = live || allow
  const provider = useMemo(
    () => makeToolProvider({ allowGeneration, isTail: () => isTailStep(key) }),
    [allowGeneration, key],
  )

  // Every action a drawn control can fire lands here: `@ToAssistant`, `@OpenUrl`, a bare
  // Button's own label, a card's action, and the form-state payload a Form button carries.
  // Without this callback the renderer delivered all of them to nobody, so a click was inert.
  const onAction = useCallback(
    (event: ActionEventLike) => {
      runAction(event, sessionId, inputActions)
    },
    [sessionId, inputActions],
  )

  // The disclosure's copy of this step: reasoning only, never the answer.
  if (groupPart === 'reasoning') {
    const reasoning = reasoningText(data.blocks)
    return reasoning ? (
      <div className="genui-reasoning" style={{ whiteSpace: 'pre-wrap' }}>
        {reasoning}
      </div>
    ) : null
  }

  // Nothing to paint: an empty settled answer, or a step that has written no text yet.
  if (mode === 'empty' || mode === 'none') return null

  return (
    <div className="genui-row" data-genui-step={key}>
      {mode === 'building' ? <div className="genui-building">Building interface…</div> : null}
      {mode === 'partial' || mode === 'text' ? (
        // Not a program: the harness's own renderer, so a turned-off mode or a model that
        // ignored the format still gets its markdown, code blocks, and tables.
        <div className="genui-fallback">
          <MarkdownText text={text} streaming={data.status === 'running'} labels={MARKDOWN_LABELS} />
        </div>
      ) : null}
      {mode === 'program' ? (
        <ReplayContext.Provider
          value={{
            allowGeneration,
            retry: () => {
              setAllow(true)
              setRetries((n) => n + 1)
            },
          }}
        >
          <ImageWaitProvider>
            <div className="genui-root">
              <Renderer
                // A retry has to re-evaluate the program's queries, which only happens on a
                // fresh mount.
                key={retries}
                library={genuiLibrary}
                response={repairProgram(programText(text))}
                toolProvider={provider}
                onAction={onAction}
                queryLoader={<QueryThinking />}
                onError={(list) => setErrors(friendlyErrors(list ?? []))}
              />
            </div>
          </ImageWaitProvider>
          {errors ? (
            <div className="genui-error" role="status">
              <strong>Part of this answer could not be drawn</strong>
              <p>{errors}</p>
            </div>
          ) : null}
        </ReplayContext.Provider>
      ) : null}
    </div>
  )
}
