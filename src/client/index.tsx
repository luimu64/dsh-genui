import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { setAnswerActions } from './actions'
import { OpenUIRow } from './renderer'
import { makeWorkflowRow } from './settings'
import openuiCss from '@openuidev/react-ui/index.css'
import defaultsCss from '@openuidev/react-ui/defaults.css'
import localCss from './styles.css'

export const name = 'dsh-genui-client'
export const inject = ['slots']

/**
 * The two faces this plugin uses on Client services it does not depend on.
 *
 * `sessions` and `conversation` belong to the Client session and conversation packages, which
 * a bundle that only paints a row has no reason to install types from. `sessions` is doubly
 * awkward: the Host's `SessionStore` augments the same Context key and wins that merge in this
 * type graph, so the merged type has no `scope`. Runtime has no such ambiguity — a browser
 * context only ever holds the Client service — so the borrowed-scope face is stated here and
 * the cast happens at the one call site.
 */
type SessionScope = {
  /** Present on a live scope; the one call a click makes. */
  conversation?: { send(text: string): Promise<void> }
}
type ClientSessions = {
  scope(id: string): SessionScope | undefined
}

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

  // A click inside a rendered answer has to reach the session it came from, and a slot
  // renderer has no Cordis context to reach it with. The row carries the session id; the
  // sessions service is the only thing that turns it back into a scope, so the two verbs are
  // published here once for `src/client/actions.ts` to read at click time.
  //
  // `sessions` is optional by composition, so this rides an injection rather than the plugin's
  // own `inject` list: a shell without it still mounts the renderer, and a click then falls
  // back to the composer. The send itself is read off the borrowed scope at call time, since
  // only a scope-addressed context can send (`ctx.conversation.send` refuses at the root).
  ctx.inject(['sessions'], (scoped) => {
    const sessions = scoped.sessions as unknown as ClientSessions
    setAnswerActions({
      send(sessionId, text) {
        // Borrowed, never retained: a row is only painted inside a live session, and a scope
        // that has gone away is a click that should fall through to the composer instead.
        //
        // Reading a service off a context is a property access that throws when nothing
        // provides it, so an absent `conversation` has to become `false` here - an exception
        // thrown inside a click handler is a dead button, which is the bug being fixed.
        try {
          const conversation = sessions.scope(sessionId)?.conversation
          if (!conversation) return false
          void conversation.send(text).catch(() => {
            // A business failure lands in the session's `promptError`, which the composer and
            // the turn error row already paint. There is nothing useful to say on top of it.
          })
          return true
        } catch {
          return false
        }
      },
      open(url) {
        window.open(url, '_blank', 'noopener,noreferrer')
      },
    })
    scoped.effect(() => () => setAnswerActions(null))
  })

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
