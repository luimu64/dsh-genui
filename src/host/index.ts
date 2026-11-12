import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
import { Config, type Config as GenuiConfig } from './config'
import { createGenuiHostService } from './registry'
import { registerRoutes } from './routes'
import { registerAgentPrompt } from './prompt'
import { createModeStore } from './mode'
import { registerCommands } from './commands'

export const name = 'dsh-genui'
export const inject = ['webServer', 'systemPrompt']
export { Config }

export function apply(ctx: Context, config: GenuiConfig): void {
  const mode = createModeStore(undefined, { defaultOn: () => config.defaultOn.get() })
  // Published for the optional companions: a bundle that serves a `Query()` tool registers its
  // prompt text here instead of editing this bundle's assets, and none of them has to be
  // installed for the answer format to work.
  const service = createGenuiHostService()
  ctx.provide('genui', service)

  ctx.effect(() => {
    const disposers = registerRoutes(ctx, mode)
    return () => disposers.forEach((dispose) => dispose())
  })
  registerAgentPrompt(ctx, config, mode, service)
  registerCommands(ctx, mode)
}
