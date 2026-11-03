/**
 * OpenUI mode: whether *this conversation* is asked to answer in openui-lang.
 *
 * Per session, not per instance. A harness used for everything cannot have one global switch:
 * turning it on for one conversation would rewrite the answer format of every other one, and
 * an agent only gets its prompt sections when it is created, so a global flag also made old
 * and new conversations disagree. `/openui on` in a conversation enables that conversation,
 * and nothing else.
 *
 * The set is persisted next to the DSH home, keyed by session id, so a restart keeps each
 * conversation's choice.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface ModeStore {
  /** Whether this session's answers are OpenUI programs. */
  isOn(sessionId: string): boolean
  set(sessionId: string, on: boolean): void
  /** Session ids currently on, for status and for the debug route. */
  sessions(): string[]
  /** Where the set lives. */
  readonly file: string
}

export function modeFile(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'genui-mode.json')
}

function readSessions(file: string): string[] {
  try {
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { sessions?: unknown; openui?: unknown }
    if (Array.isArray(parsed.sessions)) {
      return [...new Set(parsed.sessions.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    }
    // The first shape was one instance-wide boolean; it cannot name a session, so it is
    // dropped rather than guessed at.
    return []
  } catch {
    return []
  }
}

export function createModeStore(file: string = modeFile()): ModeStore {
  let on = new Set(readSessions(file))

  const persist = () => {
    try {
      mkdirSync(dirname(file), { recursive: true })
      const temp = `${file}.${process.pid}.tmp`
      writeFileSync(temp, `${JSON.stringify({ sessions: [...on] }, null, 2)}\n`)
      renameSync(temp, file)
    } catch {
      // A read-only home costs a restart's worth of memory, never the turn.
    }
  }

  return {
    file,
    isOn: (sessionId) => on.has(sessionId),
    set: (sessionId, next) => {
      const changed = next ? !on.has(sessionId) : on.has(sessionId)
      if (!changed) return
      on = new Set(on)
      if (next) on.add(sessionId)
      else on.delete(sessionId)
      persist()
    },
    sessions: () => [...on],
  }
}
