import Schema from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cosmokit'

export interface Config {
  /**
   * Whether a conversation answers as an OpenUI program until `/openui off` says otherwise.
   *
   * Volatile: Settings → General writes it, and the mode store reads it per answer, so a
   * deployment can switch between "interface everywhere" and "opt in per conversation" live.
   */
  defaultOn: Volatile<boolean>
}

export const Config = Schema.object({
  defaultOn: Schema.boolean().default(true).volatile(),
})
