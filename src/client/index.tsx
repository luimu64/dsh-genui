import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { OpenUIRow } from './renderer'
import openuiCss from '@openuidev/react-ui/index.css'
import defaultsCss from '@openuidev/react-ui/defaults.css'
import localCss from './styles.css'

export const name = 'dsh-genui-client'
export const inject = ['slots']

export function apply(ctx: Context): void {
  // OpenUI's token block keys off `[data-openui-theme="dark"]` on the root element, and the
  // genui image rules expect the same dark palette. Set it once, restore on unload.
  const root = document.documentElement
  const previousTheme = root.dataset.openuiTheme
  root.dataset.openuiTheme = 'dark'

  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-genui'
  style.textContent = `${openuiCss}\n${defaultsCss}\n${localCss}`
  document.head.append(style)

  ctx.effect(() => () => {
    style.remove()
    if (previousTheme === undefined) delete root.dataset.openuiTheme
    else root.dataset.openuiTheme = previousTheme
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
}
