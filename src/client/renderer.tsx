/**
 * The one row a model answer arrives in.
 *
 * This replaces the built-in `assistant-step` renderer at priority -1 rather than adding a
 * second row: the official Definition keeps publishing the Assistant payload that Turn-tail,
 * the token footer, and the process disclosure read, and only the painting changes. See
 * `test/spike.md` for why the exclusive-Definition design was dropped.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { Renderer } from '@openuidev/react-lang'
import { harnessLibrary } from './library'
import { makeToolProvider } from './toolProvider'
import { friendlyErrors, repairProgram } from './repair'
import { ReplayContext } from './replay'
import { ImageWaitProvider, useImageAnimating } from './pending'
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

/**
 * The renderer's loader for a `Query()` in flight. An image query already paints its own
 * shimmering frame, so a second indicator above it is noise.
 */
function QueryThinking(): ReactNode {
  const animating = useImageAnimating()
  if (animating) return null
  return <div className="genui-loading" role="status" aria-label="Loading" />
}

export function OpenUIRow({ node }: OpenUIRowProps): ReactNode {
  const data = node.data
  const key = stepKey(data)
  // Read once per paint: a step that streamed in this page session may queue ComfyUI, a step
  // that came out of the log may only display what the cache already holds.
  const live = observeStep(key, data.status)
  const text = assistantText(data.blocks)
  const reasoning = reasoningText(data.blocks)
  const mode = rowMode(data, text, live)

  const [allow, setAllow] = useState(false)
  const [retries, setRetries] = useState(0)
  const [errors, setErrors] = useState('')
  const allowGeneration = live || allow
  const provider = useMemo(() => makeToolProvider({ allowGeneration }), [allowGeneration])

  if (mode === 'empty') return null

  return (
    <div className="genui-row" data-genui-step={key}>
      <Reasoning text={reasoning} />
      {mode === 'building' ? <div className="genui-building">Building interface…</div> : null}
      {mode === 'partial' || mode === 'text' ? (
        <div className="genui-fallback" style={{ whiteSpace: 'pre-wrap' }}>
          {text}
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
                library={harnessLibrary}
                response={repairProgram(text)}
                toolProvider={provider}
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
