/**
 * `/openui` — flip the answer-format mode from the composer, without editing a profile.
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
    ? 'OpenUI mode is on: the next answer is written as an interface program.'
    : 'OpenUI mode is off: the next answer is ordinary markdown.'
}

export function registerCommands(ctx: Context, mode: ModeStore): void {
  ctx.inject(['commands'], (scoped) => {
    scoped.commands.register({
      name: 'openui',
      description: 'Answer as an OpenUI interface program instead of markdown',
      input: { hint: 'on | off | status' },
      handler: ({ rawInput }) => {
        const parsed = parseModeCommand(rawInput)
        if (parsed === undefined) return { kind: 'error', text: USAGE }
        if (parsed !== 'status') mode.set(parsed)
        return { kind: 'success', text: modeMessage(mode.enabled()) }
      },
    })
  })
}
