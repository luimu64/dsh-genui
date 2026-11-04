/**
 * The roster the host and the client bundle must agree on, and nothing else.
 *
 * Which workflows *exist* is a runtime question: built-ins come from `src/host/workflows.ts`
 * and a deployment can drop more definitions in its workflow directory. What is shared here
 * is the small vocabulary both halves need — the quality names a request may carry, and the
 * workflows a fresh install exposes.
 */

/**
 * The workflows a fresh install exposes. Everything else is opt-in: a deployment names it in
 * `workflows` (Settings → General writes that field), and a definition file on disk can add
 * more without touching source.
 */
export const DEFAULT_WORKFLOWS: readonly string[] = ['real']

/** How much compute to spend on one workflow. */
export const QUALITY_IDS = ['fast', 'high'] as const
export type QualityId = (typeof QUALITY_IDS)[number]

export function isQualityId(value: unknown): value is QualityId {
  return typeof value === 'string' && (QUALITY_IDS as readonly string[]).includes(value)
}

/**
 * The workflows a deployment asked for, in a shape the rest of the code can trust: duplicates
 * collapsed, non-strings dropped, and an empty or missing list read as the default.
 *
 * Ids are *not* validated here. Whether a workflow exists is the registry's business, so a
 * deployment may name one whose files land after the config was written.
 */
export function parseWorkflows(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_WORKFLOWS]
  const asked = [...new Set(value.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim()))]
  return asked.length > 0 ? asked : [...DEFAULT_WORKFLOWS]
}
