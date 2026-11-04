/**
 * Shared test fixtures. `Config` is the resolved config a running bundle receives, so every
 * key is present; tests override only the ones they care about.
 */
import type { Config } from '../src/host/config'

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    comfyBase: 'http://127.0.0.1:8188',
    imagesDir: '/nonexistent/genui-images',
    maxBatch: 8,
    pollMs: 750,
    minPngBytes: 30_000,
    defaultOn: false,
    filePrefix: 'genui',
    ...overrides,
  }
}
