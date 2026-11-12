/**
 * Settings → General: the answer-format switch.
 *
 * One row, one decision: do conversations answer as OpenUI programs by default, or does the
 * interface need a `/openui on` in the conversation first. It writes this bundle's volatile
 * `defaultOn`, which the host reads per answer, so the change lands on the next answer instead
 * of the next restart.
 *
 * Image workflows are a different row, registered by the image bundle against its own config
 * entry - this bundle has no opinion about which picture pipeline exists.
 */
import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context } from '@deepseek-ai/cordis'

/**
 * The Loader entry id this bundle ships as (`cordis.patch.yml`). The settings form is
 * addressed by that id, so a profile that renames the row needs this constant changed with it.
 */
export const SETTINGS_ENTRY = 'genui'

interface AnswerFormatValues {
  defaultOn?: unknown
}

const COPY = {
  label: 'Answer as interface by default',
  hint: 'Every conversation answers as an OpenUI program unless it says /openui off. Turn this off to make interface answers opt-in: conversations stay markdown until /openui on.',
  locked: 'This deployment does not allow its settings to be written from the browser.',
  refused: 'The harness refused the change.',
} as const

export function makeAnswerFormatRow(ctx: Context) {
  return function AnswerFormatSettings(): ReactNode {
    const form = useMemo(() => ctx.configForms.get<AnswerFormatValues>(SETTINGS_ENTRY), [ctx])
    const subscribe = useMemo(() => form.subscribe.bind(form), [form])
    const snapshot = useSyncExternalStore(subscribe, () => form.getSnapshot())
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)

    // Absent or unreadable means the schema default, which is on.
    const defaultOn = typeof snapshot.value?.defaultOn === 'boolean' ? snapshot.value.defaultOn : true
    const writable = snapshot.status === 'ready' && snapshot.writable

    const setDefaultOn = useCallback(
      async (next: boolean) => {
        setBusy(true)
        setError('')
        try {
          const accepted = await form.set('defaultOn', next)
          if (!accepted) setError(COPY.refused)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      },
      [form],
    )

    // The namespace is not exposed to this page: nothing to show.
    if (snapshot.status === 'unavailable') return null

    return (
      <div className="genui-settings">
        <div className="genui-setting-row genui-settings-default">
          <div className="genui-setting-copy">
            <span className="genui-setting-label">{COPY.label}</span>
            <span className="genui-setting-hint">{COPY.hint}</span>
          </div>
          <Switch
            checked={defaultOn}
            onChange={(next) => void setDefaultOn(next)}
            label={COPY.label}
            disabled={!writable || busy}
            title={writable ? COPY.hint : COPY.locked}
          />
        </div>
        {error ? <span className="genui-setting-error">{error}</span> : null}
      </div>
    )
  }
}
