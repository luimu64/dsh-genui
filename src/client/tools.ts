/**
 * The `Query()` tools a rendered answer may call, as a registry rather than a fixed object.
 *
 * The renderer knows how to draw an answer; it does not know how to *make* anything. A tool
 * that spends a GPU or talks to another machine belongs to the bundle that serves it, which
 * registers a handler here when its client half loads. Without that bundle the registry is
 * empty, a program that calls an unknown tool fails the way an unknown tool should, and the
 * answer format still works.
 *
 * The handler is handed the turn it is running for, because "may this query do work" is a
 * property of the answer being painted (a live turn versus a replayed one), not of the tool.
 */
import type { ReplayAccess } from './replay'

/** What a handler may do for the turn currently being painted. */
export type TurnAccess = ReplayAccess

/** One tool: validate what it can, do the work, answer with the query's result. */
export type QueryTool = (args: Record<string, unknown>, turn: TurnAccess) => Promise<unknown>

/** The shape the OpenUI renderer takes as `toolProvider`. */
export interface ToolProvider {
  [tool: string]: (args: Record<string, unknown>) => Promise<unknown>
}

const tools = new Map<string, QueryTool>()

/**
 * Add (or replace) tools. The disposer removes exactly this registration, so a reload that
 * already installed a newer handler does not take it away on its way out.
 */
export function registerQueryTools(entries: Record<string, QueryTool>): () => void {
  const installed: [string, QueryTool][] = []
  for (const [name, tool] of Object.entries(entries)) {
    tools.set(name, tool)
    installed.push([name, tool])
  }
  return () => {
    for (const [name, tool] of installed) {
      if (tools.get(name) === tool) tools.delete(name)
    }
  }
}

export function lookupQueryTool(name: string): QueryTool | undefined {
  return tools.get(name)
}

/** The tool names registered right now, for diagnostics and tests. */
export function queryToolNames(): string[] {
  return [...tools.keys()]
}

/**
 * One provider per painted answer, bound to that answer's turn.
 *
 * A proxy rather than a copy of the registry, so a tool registered after this row mounted
 * (the companion bundle loading a moment later, a hot reload) is still reachable, and so the
 * renderer's own `provider[name]` lookups keep working.
 */
export function makeToolProvider(turn: TurnAccess): ToolProvider {
  const bound = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>()

  const binding = (name: string) => {
    const existing = bound.get(name)
    if (existing) return existing
    const tool = lookupQueryTool(name)
    if (!tool) return undefined
    const call = (args: Record<string, unknown>) => Promise.resolve().then(() => tool(args, turn))
    bound.set(name, call)
    return call
  }

  return new Proxy({} as ToolProvider, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined
      return binding(prop)
    },
    has(_target, prop) {
      return typeof prop === 'string' && lookupQueryTool(prop) !== undefined
    },
    ownKeys() {
      return [...tools.keys()]
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop !== 'string') return undefined
      const call = binding(prop)
      return call ? { configurable: true, enumerable: true, writable: false, value: call } : undefined
    },
  })
}
