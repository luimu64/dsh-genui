/**
 * Shared test fixtures. `Config` is the resolved config a running bundle receives, so every
 * key is present; tests override only the ones they care about.
 *
 * `workflows` is a volatile field in production (the Settings row writes it live), so the
 * fixture wraps a plain list in a reference; tests that need to *change* it can hold on to
 * the reference they passed.
 */
import { createVolatile, type Volatile } from '@deepseek-ai/cosmokit'
import type { Config } from '../src/host/config'

export type TestConfigOverrides = Partial<Omit<Config, 'workflows'>> & {
  workflows?: string[] | Volatile<string[]>
}

export function testConfig(overrides: TestConfigOverrides = {}): Config {
  const { workflows, ...rest } = overrides
  return {
    comfyBase: 'http://127.0.0.1:8188',
    imagesDir: '/nonexistent/genui-images',
    maxBatch: 8,
    pollMs: 750,
    minPngBytes: 30_000,
    defaultOn: false,
    filePrefix: 'genui',
    // Tests exercise the full surface; the *default* install is ['real'] and is covered in
    // config.test.ts and the opt-in cases in service.test.ts.
    workflows: Array.isArray(workflows) ? createVolatile(workflows) : workflows ?? createVolatile(['real', 'anime']),
    ...rest,
  }
}
