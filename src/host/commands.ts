/**
 * `/openui` — flip the answer format of the conversation you are in, from the composer.
 *
 * Registered through `ctx.inject` so a composition without a command runtime simply does not
 * get the command, instead of the whole plugin waiting for a service it does not need.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type { ModeStore } from './mode'

const USAGE = 'usage: /openui on | off | status'

export function parseModeCommand(rawInput: string): boolean | undefined | 'status' {
  const word = rawInput.trim().toLowerCase()
  if (word === '' || word === 'status') return 'status'
  if (word === 'on' || word === 'enable' || word === 'true') return true
  if (word === 'off' || word === 'disable' || word === 'false') return false
  return undefined
}

export function modeMessage(enabled: boolean): string {
  return enabled
    ? 'OpenUI is on for this conversation: the next answer is written as an interface program.'
    : 'OpenUI is off for this conversation: answers are ordinary markdown.'
}

export function registerCommands(ctx: Context, mode: ModeStore): void {
  ctx.inject(['commands'], (scoped) => {
    scoped.commands.register({
      name: 'openui',
      description: 'Answer this conversation as OpenUI interface programs instead of markdown',
      input: { hint: 'on | off | status' },
      handler: ({ agent, rawInput }) => {
        const parsed = parseModeCommand(rawInput)
        if (parsed === undefined) return { kind: 'error', text: USAGE }
        const sessionId = agent.session.id
        // Turning it off has to work for a conversation whose agent predates the plugin, so
        // the section is registered for every main agent and decided here, per assembly.
        if (parsed !== 'status') mode.set(sessionId, parsed)
        return { kind: 'success', text: modeMessage(mode.isOn(sessionId)) }
      },
    })
  })
}
