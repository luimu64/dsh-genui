/**
 * The workflow registry.
 *
 * A **workflow** is one selectable image pipeline: a lane id the model may ask for, one or
 * two graphs (fast/high), the settings those graphs are tuned for, optional preset graphs and
 * an optional prompt section. The request carries `lane: "<id>"`; nothing in the code knows
 * which workflows exist.
 *
 * Two sources feed the registry:
 *
 * - the built-in definitions below, whose graphs are imported at build time;
 * - every `*.json` in the workflow directory (default `<data>/dsh-genui/workflows`,
 *   `$DSH_HOME/genui/workflows` when `DSH_HOME` is set), whose graphs and prompt file are read
 *   from disk next to it. Dropping two files in there is all it takes to add a workflow - no
 *   source edit, no rebuild.
 *
 * A user definition may not shadow a built-in id: that would make "delete" ambiguous (delete
 * the file and the built-in reappears). It is skipped with a warning instead.
 *
 * Graph shape: the mutator addresses nodes by id, so a template must keep the conventional
 * skeleton documented in docs/graphs.md:
 *
 *   3   positive CLIPTextEncode   <- prompt (appended to the template's own prefix when
 *   4   negative CLIPTextEncode      `carriesStyle` is set)
 *   5   empty latent              <- width, height, batch_size
 *   6   base KSampler              <- seed, steps, cfg
 *   7   VAEDecode                 <- rewired by the hires pass
 *   9   SaveImage                 <- filename_prefix
 *   21/22 reserved for the hires pass (added at runtime, never in a template)
 */
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { QualityId } from '../shared/models'
import animeGraph from '../../assets/anime.json'
import animeHighGraph from '../../assets/anime-hq.json'
import animeMiaoGraph from '../../assets/anime-miao.json'
import animeDasiwaGraph from '../../assets/anime-dasiwa.json'
import realGraph from '../../assets/real.json'
import realHighGraph from '../../assets/real-hq.json'
import mossFastGraph from '../../assets/moss-fast.json'
import mossHighGraph from '../../assets/moss-high.json'
import editGraph from '../../assets/edit.json'

export interface GraphNode {
  class_type: string
  inputs: Record<string, any>
}

export type Graph = Record<string, GraphNode>

/** One graph plus the settings it is tuned for. */
export interface WorkflowModel {
  graph: Graph
  /** File-name stem: renders land as `<filePrefix>_<suffix>_<seed>.png`. */
  suffix: string
  width: number
  height: number
  steps: number
  cfg: number
  /**
   * Append the graph's own positive prefix to the user's prompt. True for booru-tag models
   * whose template carries a quality/style block; false for caption models.
   */
  carriesStyle: boolean
  /**
   * Let the model letter the picture. Only the moss caption models want it: every other
   * workflow gets the TEXT_NEGATIVES block appended to its negative on every render.
   */
  allowsText: boolean
}

export interface WorkflowDefinition {
  id: string
  label: string
  description: string
  /** False only for a definition loaded from the workflow directory. */
  builtin: boolean
  /** Where a user definition lives; undefined for a built-in. */
  source?: string
  /** Prompt section text, when the workflow ships one. */
  prompt?: string
  fast: WorkflowModel
  /** High quality. Falls back to `fast` when the definition names one graph only. */
  high: WorkflowModel
  /** Extra graphs that replace `quality` entirely (a full checkpoint at its own settings). */
  presets: Record<string, WorkflowModel>
}

/** What the Settings page lists. */
export interface WorkflowSummary {
  id: string
  label: string
  description: string
  builtin: boolean
  /** `['fast']` when the workflow defines one graph, `['fast', 'high']` otherwise. */
  qualities: QualityId[]
  presets: string[]
  hasPrompt: boolean
  enabled: boolean
}

export interface WorkflowRegistry {
  /** Every known workflow, built-ins first. */
  list(): WorkflowDefinition[]
  /** List entries with the enabled flag folded in, in `list()` order. */
  summaries(enabled: readonly string[]): WorkflowSummary[]
  /** Look a workflow up; an unknown id triggers one rescan, so a dropped file works at once. */
  get(id: string): WorkflowDefinition | undefined
  /** The model a request resolves to: a preset when one was asked for, else the quality. */
  model(id: string, quality: QualityId, preset?: string): WorkflowModel | undefined
  /** Prompt sections for the enabled workflows, in registry order. */
  prompts(enabled: readonly string[]): string[]
  /** Delete a user definition. A built-in is refused: disable it instead. */
  remove(id: string): boolean
  /** Forget the scanned directory, so the next call re-reads it. */
  reload(): void
  /** Where user definitions are read from. */
  readonly dir: string
}

// ---------------------------------------------------------------------------
// Built-ins
// ---------------------------------------------------------------------------

function spec(graph: unknown, rest: Omit<WorkflowModel, 'graph'>): WorkflowModel {
  return { graph: graph as Graph, ...rest }
}

/** A built-in may name a prompt asset file; the registry reads it from `assets/`. */
type BuiltinInput = Omit<WorkflowDefinition, 'builtin' | 'prompt'> & { promptFile?: string }

/** The two graphs that ship with the bundle, described once. */
const REAL: BuiltinInput = {
  id: 'real',
  label: 'Photographs',
  description:
    'A caption model for photographs, products, places and people. One natural-language sentence per prompt.',
  fast: spec(realGraph, {
    suffix: 'real',
    width: 832,
    height: 1216,
    steps: 4,
    cfg: 1,
    carriesStyle: false,
    allowsText: true,
  }),
  high: spec(realHighGraph, {
    suffix: 'real_hq',
    width: 992,
    height: 1504,
    steps: 50,
    cfg: 3,
    carriesStyle: false,
    allowsText: true,
  }),
  presets: {},
}

/** The opt-in booru-tag workflow, with its two full-checkpoint presets. */
const ANIME: BuiltinInput = {
  id: 'anime',
  label: 'Anime',
  description:
    'Booru-tag models for anime, manga and stylised illustration, plus two full-checkpoint presets at their own settings.',
  promptFile: 'prompt-anime.md',
  fast: spec(animeGraph, {
    suffix: 'anime',
    width: 832,
    height: 1216,
    steps: 8,
    cfg: 1,
    carriesStyle: true,
    allowsText: false,
  }),
  high: spec(animeHighGraph, {
    suffix: 'anime_hq',
    width: 832,
    height: 1216,
    steps: 30,
    cfg: 5,
    carriesStyle: true,
    allowsText: false,
  }),
  presets: {
    miaoharem: spec(animeMiaoGraph, {
      suffix: 'anima_miao',
      width: 832,
      height: 1216,
      steps: 30,
      cfg: 4.5,
      carriesStyle: true,
      allowsText: false,
    }),
    dasiwa: spec(animeDasiwaGraph, {
      suffix: 'anima_dasiwa',
      width: 832,
      height: 1216,
      steps: 30,
      cfg: 4.5,
      carriesStyle: true,
      allowsText: false,
    }),
  },
}

/**
 * The caption route on the weights `real` runs: the undistilled SFT checkpoint at the model
 * card's own settings instead of the four-step LoRA, with lettering left alone. Slow on
 * purpose. The reason to reach for it is a long prompt, a laid-out scene, or text the picture
 * has to spell.
 */
const MOSS: BuiltinInput = {
  id: 'moss',
  label: 'MOSS-Image (SFT)',
  description:
    'The 5B caption model the real lane runs, without its four-step LoRA: 25 steps at CFG 2.5 fast, 50 at CFG 3 with skip-layer guidance for high. Strong at long prompts, quoted lettering and layout.',
  promptFile: 'prompt-moss.md',
  fast: spec(mossFastGraph, {
    suffix: 'moss',
    width: 832,
    height: 1216,
    steps: 25,
    cfg: 2.5,
    carriesStyle: false,
    allowsText: true,
  }),
  high: spec(mossHighGraph, {
    suffix: 'moss_hq',
    width: 992,
    height: 1504,
    steps: 50,
    cfg: 3,
    carriesStyle: false,
    allowsText: true,
  }),
  presets: {},
}

/** The reference-conditioned edit lane. It is a tool, not a selectable workflow. */
export const EDIT_MODEL: WorkflowModel = spec(editGraph, {
  suffix: 'edit',
  width: 832,
  height: 1216,
  steps: 4,
  cfg: 1,
  carriesStyle: false,
  allowsText: false,
})

const BUILTINS: BuiltinInput[] = [REAL, ANIME, MOSS]

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/** Read a file from the bundle's `assets/`, from the built bundle or from source. */
function readAsset(name: string): string | undefined {
  const candidates = [
    new URL(`../assets/${name}`, import.meta.url), // built lib/index.js
    new URL(`../../assets/${name}`, import.meta.url), // src/host/workflows.ts
  ]
  for (const url of candidates) {
    try {
      const file = fileURLToPath(url)
      if (existsSync(file)) return readFileSync(file, 'utf8')
    } catch {
      // An unreadable candidate is simply not the one.
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// User definitions
// ---------------------------------------------------------------------------

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

interface DefinitionFile {
  id?: unknown
  label?: unknown
  description?: unknown
  suffix?: unknown
  carriesStyle?: unknown
  /** Default false: a dropped-in workflow suppresses lettering unless it opts in. */
  allowsText?: unknown
  graphs?: { fast?: unknown; high?: unknown }
  defaults?: {
    width?: unknown
    height?: unknown
    steps?: unknown
    cfg?: unknown
  }
  presets?: Record<string, { graph?: unknown; width?: unknown; height?: unknown; steps?: unknown; cfg?: unknown; suffix?: unknown }>
  prompt?: unknown
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : fallback
}

/** A default may be one number for both qualities or `{ fast, high }`. */
function perQuality(value: unknown, quality: QualityId, fallback: number): number {
  if (value && typeof value === 'object') return num((value as Record<string, unknown>)[quality], fallback)
  return num(value, fallback)
}

function readGraph(path: string): Graph {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Graph
  if (!parsed || typeof parsed !== 'object') throw new Error('graph is not an object')
  const nodes = Object.values(parsed)
  if (!nodes.some((node) => node && typeof node === 'object' && 'class_type' in node)) {
    throw new Error('graph has no class_type nodes')
  }
  return parsed
}

/**
 * Turn one `*.json` next to its graphs into a definition. Throws with a readable reason so
 * the caller can skip a broken file without taking the plugin down.
 */
function loadDefinition(file: string): WorkflowDefinition {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as DefinitionFile
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!ID.test(id)) throw new Error(`invalid workflow id ${JSON.stringify(raw.id)}`)
  const dir = dirname(file)
  const graphName = (value: unknown, what: string): string => {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${what} graph is required`)
    const name = value.trim()
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      throw new Error(`${what} graph must be a plain file name`)
    }
    return join(dir, name)
  }

  const fastPath = graphName(raw.graphs?.fast, 'fast')
  const highPath = raw.graphs?.high === undefined ? fastPath : graphName(raw.graphs.high, 'high')
  const suffix = typeof raw.suffix === 'string' && raw.suffix.trim() ? raw.suffix.trim() : id
  const carriesStyle = raw.carriesStyle === true
  const allowsText = raw.allowsText === true
  const width = num(raw.defaults?.width, 832)
  const height = num(raw.defaults?.height, 1216)

  const model = (graph: Graph, quality: QualityId, extra: { steps?: unknown; cfg?: unknown; suffix?: string } = {}): WorkflowModel => ({
    graph,
    suffix: extra.suffix ?? (quality === 'high' ? `${suffix}_hq` : suffix),
    width,
    height,
    steps: perQuality(extra.steps ?? raw.defaults?.steps, quality, quality === 'high' ? 30 : 4),
    cfg: perQuality(extra.cfg ?? raw.defaults?.cfg, quality, quality === 'high' ? 3 : 1),
    carriesStyle,
    allowsText,
  })

  const fastGraph = readGraph(fastPath)
  const highGraph = highPath === fastPath ? fastGraph : readGraph(highPath)

  const presets: Record<string, WorkflowModel> = {}
  for (const [presetId, preset] of Object.entries(raw.presets ?? {})) {
    if (!ID.test(presetId)) throw new Error(`invalid preset id ${JSON.stringify(presetId)}`)
    const presetPath = graphName(preset?.graph, `preset "${presetId}"`)
    presets[presetId] = model(readGraph(presetPath), 'fast', {
      steps: preset.steps,
      cfg: preset.cfg,
      suffix: typeof preset.suffix === 'string' && preset.suffix ? preset.suffix : `${suffix}_${presetId}`,
    })
  }

  let prompt: string | undefined
  if (typeof raw.prompt === 'string' && raw.prompt.trim()) {
    const name = raw.prompt.trim()
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      throw new Error('prompt must be a plain file name')
    }
    const promptPath = join(dir, name)
    if (existsSync(promptPath)) prompt = readFileSync(promptPath, 'utf8').trim()
  }

  // One graph means one object: the service compares the two references to tell a
  // single-graph workflow from a two-graph one.
  const fast = model(fastGraph, 'fast')
  const high = highPath === fastPath ? fast : model(highGraph, 'high')

  return {
    id,
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : id,
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    builtin: false,
    source: file,
    prompt,
    fast,
    high,
    presets,
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const RESCAN_MS = 1000

function builtinDefinitions(): WorkflowDefinition[] {
  return BUILTINS.map((definition) => {
    const prompt = definition.promptFile ? readAsset(definition.promptFile)?.trim() : undefined
    return { ...definition, builtin: true, prompt } as WorkflowDefinition
  })
}

export function createWorkflowRegistry(options: {
  dir: string
  log?: { warn: (message: string) => void }
}): WorkflowRegistry {
  const builtins = builtinDefinitions()
  const builtinIds = new Set(builtins.map((definition) => definition.id))
  let user: WorkflowDefinition[] = []
  let scannedAt = 0

  const warn = (message: string) => options.log?.warn(`workflows: ${message}`)

  const scan = (force: boolean): void => {
    const now = Date.now()
    if (!force && now - scannedAt < RESCAN_MS) return
    scannedAt = now
    let names: string[] = []
    try {
      names = readdirSync(options.dir).filter((name) => name.toLowerCase().endsWith('.json'))
    } catch {
      user = []
      return
    }
    const loaded: WorkflowDefinition[] = []
    for (const name of names.sort()) {
      const file = join(options.dir, name)
      try {
        const definition = loadDefinition(file)
        if (builtinIds.has(definition.id)) {
          warn(`${name} uses the built-in id "${definition.id}" and was ignored`)
          continue
        }
        loaded.push(definition)
      } catch (err) {
        warn(`${name} was ignored: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    user = loaded
  }

  const all = (): WorkflowDefinition[] => [...builtins, ...user]

  const registry: WorkflowRegistry = {
    dir: options.dir,

    list() {
      scan(false)
      return all()
    },

    summaries(enabled) {
      scan(false)
      const on = new Set(enabled)
      return all().map((definition) => ({
        id: definition.id,
        label: definition.label,
        description: definition.description,
        builtin: definition.builtin,
        qualities: definition.high === definition.fast ? (['fast'] as QualityId[]) : (['fast', 'high'] as QualityId[]),
        presets: Object.keys(definition.presets),
        hasPrompt: typeof definition.prompt === 'string' && definition.prompt.length > 0,
        enabled: on.has(definition.id),
      }))
    },

    get(id) {
      const found = all().find((definition) => definition.id === id)
      if (found) return found
      // A file dropped while the harness runs should work on the next request.
      scan(true)
      return all().find((definition) => definition.id === id)
    },

    model(id, quality, preset) {
      const definition = registry.get(id)
      if (!definition) return undefined
      if (preset) return definition.presets[preset]
      return definition[quality]
    },

    prompts(enabled) {
      scan(false)
      const on = new Set(enabled)
      return all()
        .filter((definition) => on.has(definition.id) && definition.prompt)
        .map((definition) => definition.prompt as string)
    },

    remove(id) {
      scan(false)
      const definition = user.find((candidate) => candidate.id === id)
      if (!definition?.source) return false
      try {
        rmSync(definition.source, { force: true })
      } catch (err) {
        warn(`could not delete ${definition.source}: ${err instanceof Error ? err.message : String(err)}`)
        return false
      }
      user = user.filter((candidate) => candidate.id !== id)
      return true
    },

    reload() {
      scan(true)
    },
  }

  scan(true)
  return registry
}
