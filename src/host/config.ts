import { homedir } from 'node:os'
import { join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_WORKFLOWS } from '../shared/models'

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
  /** Whether a conversation answers as an OpenUI program until `/openui off` says otherwise. */
  defaultOn: boolean
  /** Stem of render file names: `<filePrefix>_<lane>_<seed>.png`. */
  filePrefix: string
  /**
   * Image workflows this deployment exposes. Defaults to `['real']`; add `'anime'` to opt in
   * to the anime lane, its full-checkpoint presets and its prompt section.
   */
  workflows: string[]
}

/**
 * Where renders live when the operator does not say.
 *
 * The XDG data directory, not a path relative to the checkout and not a path from whatever
 * machine this was first run on: a published bundle has no idea who installs it, and a
 * packaged install should not write into the package. `$XDG_DATA_HOME` is honoured.
 */
export function defaultImagesDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const data = env.XDG_DATA_HOME?.trim() || join(home, '.local', 'share')
  return join(data, 'dsh-genui', 'images')
}

export const Config: Schema<Config> = Schema.object({
  comfyBase: Schema.string().default('http://127.0.0.1:8188'),
  imagesDir: Schema.string().default(defaultImagesDir()),
  maxBatch: Schema.number().default(8),
  pollMs: Schema.number().default(750),
  minPngBytes: Schema.number().default(30_000),
  defaultOn: Schema.boolean().default(true),
  filePrefix: Schema.string().default('genui'),
  workflows: Schema.array(Schema.string()).default([...DEFAULT_WORKFLOWS]),
})
