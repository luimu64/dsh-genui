import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
import { Config, type Config as GenuiConfig } from './config'
import { createGenuiService } from './service'
import { registerRoutes } from './routes'
import { registerAgentPrompt } from './prompt'
import { createModeStore } from './mode'
import { registerCommands } from './commands'

export const name = 'dsh-genui'
export const inject = ['webServer', 'systemPrompt', 'agents']
export { Config }

export function apply(ctx: Context, config: GenuiConfig): void {
  const mode = createModeStore()
  const service = createGenuiService(config)
  ctx.effect(() => {
    const disposers = registerRoutes(ctx, service, config, mode)
    return () => disposers.forEach((dispose) => dispose())
  })
  registerAgentPrompt(ctx, config, mode)
  registerCommands(ctx, mode)
}
