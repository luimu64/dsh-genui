/**
 * Settings → General: the workflow switch.
 *
 * The host config field is volatile, so this is a live control rather than a note telling the
 * reader to edit YAML: the write goes through the harness settings document (persisted into
 * the profile's Cordis patch), and the host reads the reference per request, so the next
 * prompt and the next render see the new set.
 *
 * The row is registered only when the client composes the settings service. A deployment
 * without Settings keeps the assistant renderer and simply has no switch, which is why this
 * lives behind `ctx.inject` rather than in the plugin's required services.
 */
import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_WORKFLOWS, isLaneId, type LaneId } from '../shared/models'

/**
 * The Loader entry id this bundle ships as (`cordis.patch.yml`). The settings form is
 * addressed by that id, so a profile that renames the row needs this constant changed with it.
 */
export const SETTINGS_ENTRY = 'genui'

const COPY = {
  label: 'Anime workflow',
  hint: 'Adds the anime lane, its full-checkpoint presets and its prompt section to future answers.',
  locked: 'This deployment does not allow its settings to be written from the browser.',
  refused: 'The harness refused the change.',
}

interface WorkflowValues {
  workflows?: unknown
}

function lanesOf(value: WorkflowValues | undefined): LaneId[] {
  const listed = value?.workflows
  if (!Array.isArray(listed)) return [...DEFAULT_WORKFLOWS]
  const lanes = listed.filter(isLaneId)
  return lanes.length > 0 ? [...new Set(lanes)] : [...DEFAULT_WORKFLOWS]
}

/** One switch: whether the opt-in anime workflow is part of this deployment. */
export function makeWorkflowRow(ctx: Context) {
  return function WorkflowRow(): ReactNode {
    const form = useMemo(() => ctx.configForms.get<WorkflowValues>(SETTINGS_ENTRY), [ctx])
    const subscribe = useMemo(() => form.subscribe.bind(form), [form])
    const snapshot = useSyncExternalStore(subscribe, () => form.getSnapshot())

    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    const lanes = lanesOf(snapshot.value)
    const enabled = lanes.includes('anime')
    const ready = snapshot.status === 'ready' && snapshot.writable

    const toggle = useCallback(
      async (next: boolean) => {
        const wanted: LaneId[] = next
          ? [...new Set<LaneId>([...lanes, 'anime'])]
          : lanes.filter((lane) => lane !== 'anime')
        setBusy(true)
        setError('')
        try {
          const accepted = await form.set('workflows', wanted.length > 0 ? wanted : [...DEFAULT_WORKFLOWS])
          if (!accepted) setError(COPY.refused)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      },
      [form, lanes],
    )

    // The namespace is not exposed to this page: nothing to show, and a dead switch would
    // only invite a click that cannot work.
    if (snapshot.status === 'unavailable') return null

    return (
      <div className="genui-setting-row">
        <div className="genui-setting-copy">
          <span className="genui-setting-label">{COPY.label}</span>
          <span className="genui-setting-hint">{COPY.hint}</span>
          {error ? <span className="genui-setting-error">{error}</span> : null}
        </div>
        <Switch
          checked={enabled}
          onChange={(next) => void toggle(next)}
          label={COPY.label}
          disabled={!ready || busy}
          title={ready ? COPY.hint : COPY.locked}
        />
      </div>
    )
  }
}
