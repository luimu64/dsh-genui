/**
 * OpenUI mode: whether *this conversation* is asked to answer in openui-lang.
 *
 * Per session, not per instance. A harness used for everything cannot have one global switch:
 * turning it on for one conversation would rewrite the answer format of every other one, and
 * an agent only gets its prompt sections when it is created, so a global flag also made old
 * and new conversations disagree. `/openui on|off` in a conversation overrides that
 * conversation, and nothing else.
 *
 * The *default* is an instance decision (`defaultOn`, on by default): a harness you keep for
 * interface answers should not need the flag typed in every new tab, and a conversation you
 * want in plain markdown opts out once. What is persisted is only the difference from that
 * default — explicit on, explicit off — so flipping `defaultOn` later moves every conversation
 * that never said anything, instead of leaving a stale set fighting the config.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface ModeStore {
  /** Whether this session's answers are OpenUI programs. */
  isOn(sessionId: string): boolean
  set(sessionId: string, on: boolean): void
  /** Session ids explicitly on. */
  sessions(): string[]
  /** Session ids explicitly off, i.e. opted out of a default-on instance. */
  offSessions(): string[]
  /** The instance default this store was created with. */
  readonly defaultOn: boolean
  /** Where the set lives. */
  readonly file: string
}

export function modeFile(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'genui-mode.json')
}

function unique(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return [...new Set(input.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

function readState(file: string): { on: string[]; off: string[] } {
  try {
    if (!existsSync(file)) return { on: [], off: [] }
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      sessions?: unknown
      off?: unknown
      openui?: unknown
    }
    const on = unique(parsed.sessions)
    // A session named in both is on: an explicit on is the more specific statement.
    const off = unique(parsed.off).filter((id) => !on.includes(id))
    // The first shape was one instance-wide boolean; it cannot name a session, so it is
    // dropped rather than guessed at.
    return { on, off }
  } catch {
    return { on: [], off: [] }
  }
}

export function createModeStore(
  file: string = modeFile(),
  options: { defaultOn?: boolean } = {},
): ModeStore {
  const defaultOn = options.defaultOn ?? true
  const state = readState(file)
  let on = new Set(state.on)
  let off = new Set(state.off)

  const persist = () => {
    try {
      mkdirSync(dirname(file), { recursive: true })
      const temp = `${file}.${process.pid}.tmp`
      const body = { default: defaultOn, sessions: [...on], off: [...off] }
      writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`)
      renameSync(temp, file)
    } catch {
      // A read-only home costs a restart's worth of memory, never the turn.
    }
  }

  return {
    file,
    defaultOn,
    isOn: (sessionId) => (off.has(sessionId) ? false : on.has(sessionId) || defaultOn),
    set: (sessionId, next) => {
      const current = off.has(sessionId) ? false : on.has(sessionId) || defaultOn
      if (current === next) return
      on = new Set(on)
      off = new Set(off)
      // Setting a conversation back to the instance default leaves no trace: the file says
      // only where a conversation deviates, so a later `defaultOn` change is not overridden
      // by an override the user never meant to pin.
      if (next === defaultOn) {
        on.delete(sessionId)
        off.delete(sessionId)
      } else if (next) {
        on.add(sessionId)
        off.delete(sessionId)
      } else {
        off.add(sessionId)
        on.delete(sessionId)
      }
      persist()
    },
    sessions: () => [...on],
    offSessions: () => [...off],
  }
}
