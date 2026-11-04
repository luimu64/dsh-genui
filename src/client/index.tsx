import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { OpenUIRow } from './renderer'
import { makeWorkflowRow } from './settings'
import openuiCss from '@openuidev/react-ui/index.css'
import defaultsCss from '@openuidev/react-ui/defaults.css'
import localCss from './styles.css'

export const name = 'dsh-genui-client'
export const inject = ['slots']

export function apply(ctx: Context): void {
  // No `data-openui-theme` here on purpose. Latching OpenUI to dark meant a light shell grew
  // dark cards, and it was a second theme to keep in sync with the harness one. styles.css
  // re-points every OpenUI colour, radius and type role at the `--dsw-*` tokens instead, so
  // the program follows the shell's light/dark switch by inheritance alone.
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-genui'
  style.textContent = `${openuiCss}\n${defaultsCss}\n${localCss}`
  document.head.append(style)

  ctx.effect(() => () => {
    style.remove()
  })

  // Shadow the built-in Assistant row instead of adding a second one: the official
  // Definition keeps publishing the data Turn-tail, token usage, and the process
  // disclosure read. Lower priority wins a keyed cell.
  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register(
      { name: 'conversation.chat.node', key: 'assistant-step', priority: -1 },
      OpenUIRow,
    ),
  )

  // Settings → General gets our rows when the shell composes the settings transport.
  //
  // `configForms` provides the form, and `remote` is what the form subscribes to for
  // invalidation - the shipped feature rows (ui-theme's Appearance) inject both, so this does
  // too, and the row is built from the *scoped* context so the subscription rides the fiber
  // that actually has them. Declaring them here rather than in the plugin's own inject list
  // keeps the bundle loadable in a shell without Settings: the renderer still mounts, there
  // are simply no rows.
  ctx.inject(['configForms', 'remote'], (scoped) => {
    scoped.slots.inject('settings.general.item', () =>
      scoped.slots.register(
        { name: 'settings.general.item', id: 'genui-workflows', order: 40 },
        makeWorkflowRow(scoped),
      ),
    )
  })
}
