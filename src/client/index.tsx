import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { OpenUIRow } from './renderer'

export const name = 'dsh-genui-client'
export const inject = ['slots']

export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register(
      { name: 'conversation.chat.node', key: 'assistant-step', priority: -1 },
      OpenUIRow,
    ),
  )
}
