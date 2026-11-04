/**
 * The model registry: which graph each lane/quality/preset actually runs, and the settings
 * that graph is tuned for.
 *
 * Everything model-specific lives here. `graphs.ts` knows how to mutate a graph; this file
 * knows *what* a lane means, which checkpoint it loads and what it costs. A deployment that
 * runs different weights replaces the JSON in `assets/` and, if the settings differ, the
 * numbers below - no other file has an opinion about model names, resolutions or step counts.
 *
 * Shape of a graph: the committed templates are ordinary ComfyUI API-format graphs with a
 * conventional skeleton the mutator relies on:
 *
 *   1..2   loaders (unet / clip)
 *   3      positive CLIPTextEncode   <- prompt goes here
 *   4      negative CLIPTextEncode   <- negative and the nsfw strip go here
 *   5      empty latent              <- width, height, batch_size
 *   6      the base KSampler          <- seed, steps, cfg
 *   7      VAEDecode
 *   8      VAE
 *   9      SaveImage                 <- filename_prefix
 *   21/22  reserved for the hires pass (added at runtime, never in a template)
 *
 * The edit graph uses its own numbering (see buildEditGraph) because it has no sampler of
 * its own. See docs/graphs.md for the full contract and for how to ship your own models.
 */
import type { LaneId, PresetId, QualityId } from '../shared/models'
import animeGraph from '../../assets/anime.json'
import animeHighGraph from '../../assets/anime-hq.json'
import animeMiaoGraph from '../../assets/anime-miao.json'
import animeDasiwaGraph from '../../assets/anime-dasiwa.json'
import realGraph from '../../assets/real.json'
import realHighGraph from '../../assets/real-hq.json'
import editGraph from '../../assets/edit.json'

export interface GraphNode {
  class_type: string
  inputs: Record<string, any>
}

export type Graph = Record<string, GraphNode>

export interface ModelSpec {
  /** The committed template, cloned per request. */
  graph: Graph
  /**
   * File-name stem: renders land as `<filePrefix>_<suffix>_<seed>.png`. Keep it short and
   * unique per lane so a render folder can be read at a glance.
   */
  suffix: string
  width: number
  height: number
  steps: number
  cfg: number
  /**
   * Append the template's own style prefix to the user's prompt. True for booru-tag models
   * whose template carries a quality/style block; false for caption models, which want the
   * sentence verbatim.
   */
  carriesStyle: boolean
}

/** A lane at each quality level. */
export type LaneModels = Record<QualityId, ModelSpec>

function spec(graph: unknown, rest: Omit<ModelSpec, 'graph'>): ModelSpec {
  return { graph: graph as Graph, ...rest }
}

/**
 * The two drawing lanes. `fast` is the one that renders in seconds; `high` is the same idea
 * run on the undistilled checkpoint at its published settings.
 *
 * The numbers below are defaults for the graphs that ship with this bundle. They are not
 * laws of the lanes: change them with the weights.
 */
export const LANE_MODELS: Record<LaneId, LaneModels> = {
  // Distilled anime model: a booru-tag prompt carried on top of the template's style block.
  anime: {
    fast: spec(animeGraph, {
      suffix: 'anime',
      width: 832,
      height: 1216,
      steps: 8,
      cfg: 1,
      carriesStyle: true,
    }),
    high: spec(animeHighGraph, {
      suffix: 'anime_hq',
      width: 832,
      height: 1216,
      steps: 30,
      cfg: 5,
      carriesStyle: true,
    }),
  },
  // Caption-driven photographic model: one natural-language sentence, no style prefix.
  real: {
    fast: spec(realGraph, {
      suffix: 'real',
      width: 832,
      height: 1216,
      steps: 4,
      cfg: 1,
      carriesStyle: false,
    }),
    high: spec(realHighGraph, {
      suffix: 'real_hq',
      width: 992,
      height: 1504,
      steps: 50,
      cfg: 3,
      carriesStyle: false,
    }),
  },
}

/** The reference-conditioned edit lane. It sizes itself from the source image. */
export const EDIT_MODEL: ModelSpec = spec(editGraph, {
  suffix: 'edit',
  width: 832,
  height: 1216,
  steps: 4,
  cfg: 1,
  carriesStyle: false,
})

/**
 * Extra anime checkpoints, each a full (undistilled) model at the settings its author
 * publishes. A preset replaces `quality` rather than stacking with it: a distilled step
 * budget would return mush from an undistilled checkpoint, so there is no cheaper honest
 * setting for it.
 *
 * These two are shipped as examples, and only reachable when the anime workflow is enabled.
 * Their ids appear in `assets/prompt-anime.md` rather than the core prompt, so rename them
 * there too when you swap the graphs (see docs/graphs.md).
 */
export const PRESET_MODELS: Record<PresetId, ModelSpec> = {
  miaoharem: spec(animeMiaoGraph, {
    suffix: 'anima_miao',
    width: 832,
    height: 1216,
    steps: 30,
    cfg: 4.5,
    carriesStyle: true,
  }),
  dasiwa: spec(animeDasiwaGraph, {
    suffix: 'anima_dasiwa',
    width: 832,
    height: 1216,
    steps: 30,
    cfg: 4.5,
    carriesStyle: true,
  }),
}

/** Presets are anime-lane extras: they inherit the anime workflow's enablement. */
export const PRESET_LANE: LaneId = 'anime'

/** The spec a request resolves to: a preset when one was asked for, else the lane/quality pair. */
export function modelFor(lane: LaneId, quality: QualityId, preset?: PresetId): ModelSpec {
  return preset ? PRESET_MODELS[preset] : LANE_MODELS[lane][quality]
}
