import Schema from '@deepseek-ai/schemastery'

export interface Config {
  /** Base URL of the local ComfyUI. */
  comfyBase: string
  /** Where renders are written and served from. */
  imagesDir: string
  /** Upper bound on `count` for one batch. */
  maxBatch: number
  /** History poll interval while a job runs, in ms. */
  pollMs: number
  /** A PNG under this size is a failed render, not a picture. */
  minPngBytes: number
}

export const Config: Schema<Config> = Schema.object({
  comfyBase: Schema.string().default('http://127.0.0.1:8188'),
  imagesDir: Schema.string().default('/home/luimu/.local/share/openui-harness/images'),
  maxBatch: Schema.number().default(8),
  pollMs: Schema.number().default(750),
  minPngBytes: Schema.number().default(30_000),
})
