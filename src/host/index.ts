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
import { createWorkflowRegistry } from './workflows'

export const name = 'dsh-genui'
export const inject = ['webServer', 'systemPrompt']
export { Config }

export function apply(ctx: Context, config: GenuiConfig): void {
  const mode = createModeStore(undefined, { defaultOn: config.defaultOn })
  // One registry for the service and the prompt: both must see the same workflows, including
  // a definition dropped in while the harness runs.
  const registry = createWorkflowRegistry({ dir: config.workflowDir, log: ctx.logger('dsh-genui') })
  const service = createGenuiService(config, undefined, registry)
  ctx.effect(() => {
    const disposers = registerRoutes(ctx, service, config, mode)
    return () => disposers.forEach((dispose) => dispose())
  })
  registerAgentPrompt(ctx, config, mode, registry)
  registerCommands(ctx, mode)
}
