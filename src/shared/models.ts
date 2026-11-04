/**
 * The model roster, in one place, shared by the host and the client bundle.
 *
 * The host validates what a request may ask for and picks the graph; the client declares the
 * same ids in the tool schema the model reads. Keeping the lists here is what stops the two
 * from drifting: adding a lane or a preset is an edit to this file plus a graph in `assets/`,
 * never a hunt through the routes, the service, the library and the generated prompt.
 *
 * These are ids, not models. Which checkpoint a lane actually loads is a property of the
 * graph, so a deployment that runs different weights keeps the ids and swaps the graphs.
 */

/** Style families a caller may ask for. The edit lane is deliberately absent: it takes a source. */
export const LANE_IDS = ['anime', 'real'] as const
export type LaneId = (typeof LANE_IDS)[number]

/** How much compute to spend on a lane. */
export const QUALITY_IDS = ['fast', 'high'] as const
export type QualityId = (typeof QUALITY_IDS)[number]

/**
 * Extra graphs a caller may ask for on the anime lane, each a full checkpoint at its own
 * published settings. The two shipped here are examples: rename or replace them when you
 * ship your own graphs (see docs/graphs.md).
 */
export const PRESET_IDS = ['miaoharem', 'dasiwa'] as const
export type PresetId = (typeof PRESET_IDS)[number]

/** The lane that edits an existing render rather than drawing a new one. */
export const EDIT_LANE = 'edit' as const

/** Every lane id the host knows about. */
export const ALL_LANE_IDS = [...LANE_IDS, EDIT_LANE] as const
export type Lane = (typeof ALL_LANE_IDS)[number]

export function isLaneId(value: unknown): value is LaneId {
  return typeof value === 'string' && (LANE_IDS as readonly string[]).includes(value)
}

export function isQualityId(value: unknown): value is QualityId {
  return typeof value === 'string' && (QUALITY_IDS as readonly string[]).includes(value)
}

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === 'string' && (PRESET_IDS as readonly string[]).includes(value)
}
