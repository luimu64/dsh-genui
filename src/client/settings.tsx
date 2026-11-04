/**
 * Settings → General: the workflow list.
 *
 * Each row is one workflow the harness knows about: switch it on or off for this deployment,
 * and delete a workflow that came from a definition file (built-ins can only be disabled —
 * deleting one would just unmask the packaged graph on the next start).
 *
 * Two sources meet here. The enabled set is this bundle's own volatile config field, written
 * through the harness settings document; the list itself comes from `GET /genui/workflows`,
 * which reads the registry, so a definition dropped into the workflow directory shows up on
 * the next refresh. The host reads both per request, so nothing here needs a restart.
 *
 * The row is registered only where the client composes the settings service; a deployment
 * without Settings keeps the renderer and has no list.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_WORKFLOWS } from '../shared/models'

/**
 * The Loader entry id this bundle ships as (`cordis.patch.yml`). The settings form is
 * addressed by that id, so a profile that renames the row needs this constant changed with it.
 */
export const SETTINGS_ENTRY = 'genui'

interface WorkflowSummary {
  id: string
  label: string
  description: string
  builtin: boolean
  qualities: string[]
  presets: string[]
  hasPrompt: boolean
  enabled: boolean
}

interface ListResponse {
  workflows?: WorkflowSummary[]
  dir?: string
}

interface WorkflowValues {
  workflows?: unknown
}

const COPY = {
  heading: 'Image workflows',
  hint: 'Workflows this harness can render with. Off means the model is not offered it, and a request naming it is refused.',
  empty: 'No workflows are defined.',
  refresh: 'Refresh',
  remove: 'Delete',
  locked: 'This deployment does not allow its settings to be written from the browser.',
  refused: 'The harness refused the change.',
  missing: 'definition not found',
} as const

function lanesOf(value: WorkflowValues | undefined): string[] {
  const listed = value?.workflows
  if (!Array.isArray(listed)) return [...DEFAULT_WORKFLOWS]
  const lanes = listed.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
  return lanes.length > 0 ? [...new Set(lanes)] : [...DEFAULT_WORKFLOWS]
}

async function readList(): Promise<{ workflows: WorkflowSummary[]; dir: string }> {
  const res = await fetch(new URL('/genui/workflows', document.baseURI), {
    headers: { accept: 'application/json' },
  })
  const body = (await res.json().catch(() => ({}))) as ListResponse & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `could not read the workflow list (${res.status})`)
  return { workflows: body.workflows ?? [], dir: body.dir ?? '' }
}

async function deleteWorkflow(id: string): Promise<void> {
  const res = await fetch(new URL('/genui/workflows', document.baseURI), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'remove', id }),
  })
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(body.error ?? `could not delete "${id}" (${res.status})`)
}

/** The list of known workflows, each with a switch and — when it came from a file — a delete. */
export function makeWorkflowRow(ctx: Context) {
  return function WorkflowSettings(): ReactNode {
    const form = useMemo(() => ctx.configForms.get<WorkflowValues>(SETTINGS_ENTRY), [ctx])
    const subscribe = useMemo(() => form.subscribe.bind(form), [form])
    const snapshot = useSyncExternalStore(subscribe, () => form.getSnapshot())

    const [rows, setRows] = useState<WorkflowSummary[]>([])
    const [dir, setDir] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState('')

    const load = useCallback(async () => {
      setLoading(true)
      try {
        const listed = await readList()
        setRows(listed.workflows)
        setDir(listed.dir)
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }, [])

    useEffect(() => {
      void load()
    }, [load])

    const enabled = lanesOf(snapshot.value)
    const writable = snapshot.status === 'ready' && snapshot.writable
    const on = new Set(enabled)

    const setEnabled = useCallback(
      async (id: string, next: boolean) => {
        const lanes = next ? [...new Set([...enabled, id])] : enabled.filter((lane) => lane !== id)
        setBusy(id)
        setError('')
        try {
          const accepted = await form.set('workflows', lanes.length > 0 ? lanes : [...DEFAULT_WORKFLOWS])
          if (!accepted) setError(COPY.refused)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy('')
        }
      },
      [enabled, form],
    )

    const remove = useCallback(
      async (id: string, builtin: boolean) => {
        setBusy(id)
        setError('')
        try {
          if (!builtin) await deleteWorkflow(id)
          // A deleted workflow must not stay in the enabled list: the next prompt would
          // advertise a lane whose files are gone. A built-in only ever loses its switch.
          const lanes = enabled.filter((lane) => lane !== id)
          await form.set('workflows', lanes.length > 0 ? lanes : [...DEFAULT_WORKFLOWS])
          await load()
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy('')
        }
      },
      [enabled, form, load],
    )

    // The namespace is not exposed to this page: nothing to show.
    if (snapshot.status === 'unavailable') return null

    const orphans = enabled.filter((id) => !rows.some((row) => row.id === id))

    return (
      <div className="genui-settings">
        <div className="genui-settings-head">
          <div className="genui-setting-copy">
            <span className="genui-setting-label">{COPY.heading}</span>
            <span className="genui-setting-hint">{COPY.hint}</span>
            {dir ? <span className="genui-settings-dir">{dir}</span> : null}
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {COPY.refresh}
          </Button>
        </div>

        {loading && rows.length === 0 ? (
          <span className="genui-setting-hint">reading…</span>
        ) : null}

        {!loading && rows.length === 0 && orphans.length === 0 ? (
          <span className="genui-setting-hint">{COPY.empty}</span>
        ) : null}

        <ul className="genui-settings-list">
          {rows.map((row) => (
            <li key={row.id} className="genui-setting-row">
              <div className="genui-setting-copy">
                <span className="genui-setting-label">
                  {row.label}
                  {row.builtin ? <span className="genui-settings-badge">built in</span> : null}
                </span>
                <span className="genui-setting-hint">{row.description}</span>
                <span className="genui-settings-meta">
                  {row.qualities.join(' + ')}
                  {row.presets.length > 0 ? ` · presets: ${row.presets.join(', ')}` : ''}
                  {row.hasPrompt ? ' · prompt section' : ''}
                </span>
              </div>
              <div className="genui-settings-actions">
                <Switch
                  checked={on.has(row.id)}
                  onChange={(next) => void setEnabled(row.id, next)}
                  label={`Enable ${row.label}`}
                  disabled={!writable || busy === row.id}
                  title={writable ? COPY.hint : COPY.locked}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void remove(row.id, row.builtin)}
                  disabled={!writable || busy === row.id}
                  title={row.builtin ? 'Built-in workflows can be disabled, not deleted.' : 'Delete this definition'}
                >
                  {COPY.remove}
                </Button>
              </div>
            </li>
          ))}

          {orphans.map((id) => (
            <li key={id} className="genui-setting-row is-orphan">
              <div className="genui-setting-copy">
                <span className="genui-setting-label">{id}</span>
                <span className="genui-setting-hint">
                  {COPY.missing}: enabled, but no definition was found. Drop its files in, or remove it here.
                </span>
              </div>
              <div className="genui-settings-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void remove(id, true)}
                  disabled={!writable || busy === id}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>

        {error ? <span className="genui-setting-error">{error}</span> : null}
      </div>
    )
  }
}
