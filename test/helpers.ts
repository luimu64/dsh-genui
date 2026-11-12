/**
 * Shared fixtures for the renderer bundle.
 *
 * `Config` is the resolved config a running bundle receives, so every key is present;
 * `defaultOn` is volatile in production (the Settings row writes it live), so the fixture
 * wraps a plain boolean in a reference.
 */
import { createVolatile } from '@deepseek-ai/cosmokit'
import type { Config } from '../src/host/config'
import type { ModeStore } from '../src/host/mode'

export function testConfig(overrides: { defaultOn?: boolean } = {}): Config {
  return { defaultOn: createVolatile(overrides.defaultOn ?? false) }
}

/** A mode store backed by a set, for assemblies that only need "on" or "off". */
export function modeStore(on: Set<string>, defaultOn = false): ModeStore {
  return {
    file: '/tmp/genui-mode.json',
    defaultOn,
    isOn: (id) => on.has(id),
    set: (id, next) => void (next ? on.add(id) : on.delete(id)),
    sessions: () => [...on],
    offSessions: () => [],
  }
}
