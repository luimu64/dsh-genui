import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkflowRegistry } from '../src/host/workflows'
import { createGenuiService } from '../src/host/service'
import { startFakeComfy } from './fixtures/comfy'
import { testConfig } from './helpers'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const realGraph = readFileSync(new URL('../assets/real.json', import.meta.url), 'utf8')

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'genui-workflows-'))
  dirs.push(dir)
  return dir
}

function definition(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'sketch',
    label: 'Sketch',
    description: 'Line-art models.',
    graphs: { fast: 'sketch-graph.json' },
    defaults: { width: 640, height: 960, steps: 6, cfg: 2 },
    ...overrides,
  })
}

function writeWorkflow(dir: string, body: string, name = 'sketch.json'): string {
  writeFileSync(join(dir, 'sketch-graph.json'), realGraph)
  const file = join(dir, name)
  writeFileSync(file, body)
  return file
}

describe('built-ins', () => {
  test('the shipped workflows are always present', () => {
    const registry = createWorkflowRegistry({ dir: '/nonexistent/genui-workflows' })
    expect(registry.list().map((workflow) => workflow.id)).toEqual(['real', 'anime', 'moss'])
    const real = registry.get('real')
    expect(real?.builtin).toBe(true)
    expect(real?.high).not.toBe(real?.fast)
    expect(Object.keys(registry.get('anime')?.presets ?? {})).toEqual(['miaoharem', 'dasiwa'])
    expect(Object.keys(registry.get('moss')?.presets ?? {})).toEqual([])
  })

  test('the anime workflow carries its prompt section', () => {
    const registry = createWorkflowRegistry({ dir: '/nonexistent/genui-workflows' })
    const prompts = registry.prompts(['real', 'anime'])
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('Optional workflow: anime')
    expect(registry.prompts(['real'])).toEqual([])
  })

  test('the moss workflow is the caption route: two graphs, no presets, its own section', () => {
    const registry = createWorkflowRegistry({ dir: '/nonexistent/genui-workflows' })
    const moss = registry.get('moss')
    expect(moss?.builtin).toBe(true)
    expect(moss?.high).not.toBe(moss?.fast)
    expect(moss?.fast.steps).toBe(25)
    expect(moss?.high.steps).toBe(50)
    expect(moss?.fast.allowsText).toBe(true)
    // Same weights as real, so the fast frame is the photograph lane's model.
    const real = registry.get('real')
    expect(moss?.fast.graph['1'].inputs.unet_name).toBe(real?.fast.graph['1'].inputs.unet_name)
    const prompts = registry.prompts(['real', 'moss'])
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('Optional workflow: moss')
  })
})

describe('a workflow from a definition file', () => {
  test('is listed, enabled by request, and keeps its own settings', () => {
    const dir = tempDir()
    writeWorkflow(dir, definition())
    const registry = createWorkflowRegistry({ dir })

    const sketch = registry.get('sketch')
    expect(sketch?.builtin).toBe(false)
    expect(sketch?.fast.width).toBe(640)
    expect(sketch?.fast.steps).toBe(6)
    // One graph means high mirrors fast rather than inventing a second budget.
    expect(sketch?.high).toBe(sketch?.fast)

    const summary = registry.summaries(['real', 'sketch']).find((entry) => entry.id === 'sketch')
    expect(summary).toMatchObject({ enabled: true, qualities: ['fast'], builtin: false })
  })

  test('two graphs give it a high quality of its own', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'sketch-high.json'), realGraph)
    writeWorkflow(
      dir,
      definition({
        graphs: { fast: 'sketch-graph.json', high: 'sketch-high.json' },
        defaults: { width: 640, height: 960, steps: { fast: 6, high: 30 }, cfg: { fast: 2, high: 4 } },
      }),
    )
    const sketch = createWorkflowRegistry({ dir }).get('sketch')
    expect(sketch?.high).not.toBe(sketch?.fast)
    expect(sketch?.high.suffix).toBe('sketch_hq')
    expect(sketch?.high.steps).toBe(30)
  })

  test('its prompt section is picked up when enabled', () => {
    const dir = tempDir()
    writeWorkflow(dir, definition({ prompt: 'sketch.prompt.md' }))
    writeFileSync(join(dir, 'sketch.prompt.md'), '## Sketch workflow\n\nUse short prompts.\n')
    const registry = createWorkflowRegistry({ dir })
    expect(registry.prompts(['sketch'])).toEqual(['## Sketch workflow\n\nUse short prompts.'])
    expect(registry.prompts(['real'])).toEqual([])
  })

  test('a duplicate of a built-in id is ignored, with a warning', () => {
    const dir = tempDir()
    const warnings: string[] = []
    writeWorkflow(dir, definition({ id: 'real', label: 'Shadow' }), 'shadow.json')
    const registry = createWorkflowRegistry({ dir, log: { warn: (message) => warnings.push(message) } })
    expect(registry.get('real')?.label).toBe('Photographs')
    expect(warnings.join('\n')).toContain('built-in id')
  })

  test('a broken definition is skipped without taking the registry down', () => {
    const dir = tempDir()
    const warnings: string[] = []
    writeFileSync(join(dir, 'broken.json'), '{ not json')
    const registry = createWorkflowRegistry({ dir, log: { warn: (message) => warnings.push(message) } })
    expect(registry.list().map((workflow) => workflow.id)).toEqual(['real', 'anime', 'moss'])
    expect(warnings.join('\n')).toContain('broken.json')
  })

  test('a file dropped after the scan is found on the next lookup', () => {
    const dir = tempDir()
    const registry = createWorkflowRegistry({ dir })
    expect(registry.get('sketch')).toBeUndefined()
    writeWorkflow(dir, definition())
    expect(registry.get('sketch')?.label).toBe('Sketch')
  })
})

describe('removing', () => {
  test('deletes a user definition and nothing else', () => {
    const dir = tempDir()
    const file = writeWorkflow(dir, definition())
    const registry = createWorkflowRegistry({ dir })

    expect(registry.remove('real')).toBe(false)
    expect(registry.remove('missing')).toBe(false)

    expect(registry.remove('sketch')).toBe(true)
    expect(registry.get('sketch')).toBeUndefined()
    expect(() => readFileSync(file, 'utf8')).toThrow()
  })
})

describe('a custom workflow through the service', () => {
  test('renders with its own graph and reports the quality it actually ran', async () => {
    const dir = tempDir()
    writeWorkflow(dir, definition())
    const fake = await startFakeComfy({ imageBytes: new Uint8Array([137, 80, 78, 71]), filename: 'sketch_1.png' })
    try {
      const service = createGenuiService(
        testConfig({
          comfyBase: fake.base,
          imagesDir: dir,
          workflowDir: dir,
          pollMs: 10,
          minPngBytes: 4,
          workflows: ['real', 'sketch'],
        }),
      )
      const result = await service.generate({ lane: 'sketch', quality: 'high', prompt: 'a line drawing' })
      expect(result.lane).toBe('sketch')
      // One graph means high mirrors fast, and the metadata says so.
      expect(result.quality).toBe('fast')
      const graph = fake.queued().at(-1) as any
      expect(graph.prompt['5'].inputs.width).toBe(640)
      expect(graph.prompt['6'].inputs.steps).toBe(6)
      expect(graph.prompt['9'].inputs.filename_prefix).toMatch(/^ds-\d{4}-\d{2}-\d{2}\/genui_sketch_/)
    } finally {
      fake.stop()
    }
  })
})
