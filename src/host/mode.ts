/**
 * OpenUI mode: whether the main agent is asked to answer in openui-lang.
 *
 * It is a mode, not a profile decision: one instance can be a normal coding harness and still
 * build interfaces when the user asks. The switch is persisted next to the DSH home so a
 * restart does not silently change what the assistant does.
 *
 * Turning it off only changes the instruction; the client keeps painting both shapes, because
 * a model that ignores the format still has to be readable.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface ModeStore {
  enabled(): boolean
  set(enabled: boolean): void
  /** Where the flag lives; surfaced by the command and the route. */
  readonly file: string
}

export function modeFile(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'genui-mode.json')
}

function readFlag(file: string): boolean | undefined {
  try {
    if (!existsSync(file)) return undefined
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { openui?: unknown }
    return typeof parsed.openui === 'boolean' ? parsed.openui : undefined
  } catch {
    return undefined
  }
}

export function createModeStore(defaultEnabled: boolean, file: string = modeFile()): ModeStore {
  let enabled = readFlag(file) ?? defaultEnabled
  return {
    file,
    enabled: () => enabled,
    set(next: boolean) {
      enabled = next
      try {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, `${JSON.stringify({ openui: next }, null, 2)}\n`)
      } catch {
        // A read-only home costs a restart's worth of memory, never the turn.
      }
    },
  }
}
