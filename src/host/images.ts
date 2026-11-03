/**
 * The render directory: one flat folder of PNGs, addressed by file name over
 * `/genui/images/<file>`. Every name that reaches the filesystem comes through `safeImageName`,
 * so a request can never step outside the folder.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/

/** Accept only a plain PNG file name: no separators, no traversal, no hidden files. */
export function safeImageName(name: unknown): string {
  const value = typeof name === 'string' ? name.trim() : ''
  if (!value) throw new Error('image name is empty')
  if (value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error(`unsafe image name: ${value}`)
  }
  if (!SAFE.test(value)) throw new Error(`not a png file name: ${value}`)
  return value
}

export interface RenderEntry {
  file: string
  mtimeMs: number
}

function tempName(dir: string, file: string): string {
  return join(dir, `.${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`)
}

/** Write a render, creating the folder, via a temp file + rename so a reader never sees half. */
export async function saveRender(dir: string, filename: string, bytes: Uint8Array): Promise<string> {
  const file = safeImageName(filename)
  await mkdir(dir, { recursive: true })
  const target = join(dir, file)
  const temp = tempName(dir, file)
  await writeFile(temp, bytes)
  await rename(temp, target)
  return file
}

export async function readRender(dir: string, filename: string): Promise<Uint8Array> {
  const file = safeImageName(filename)
  const bytes = await readFile(join(dir, file))
  return new Uint8Array(bytes)
}

/**
 * Newest first, `.png` only. Synchronous on purpose: the system-prompt context contract is a
 * synchronous `text()`, and an async list would be a Promise in the prompt.
 */
export function listRenders(dir: string, limit = 20): RenderEntry[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out: RenderEntry[] = []
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.png')) continue
    if (!SAFE.test(name)) continue
    try {
      const stat = statSync(join(dir, name))
      if (!stat.isFile()) continue
      out.push({ file: name, mtimeMs: stat.mtimeMs })
    } catch {
      // A file that vanished between readdir and stat is simply not listed.
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file))
  return out.slice(0, Math.max(0, limit))
}

/**
 * What `edit_image` should paint over: the named render when it is there, otherwise the
 * newest one. Throws when the folder has nothing to edit.
 */
export function resolveSource(dir: string, source?: string): string {
  const asked = source?.trim()
  if (asked) {
    const file = safeImageName(asked)
    if (!existsSync(join(dir, file))) throw new Error(`no such image: ${asked}`)
    return file
  }
  const newest = listRenders(dir, 1)[0]
  if (!newest) throw new Error(`no renders in ${dir} to edit yet`)
  return newest.file
}

/** Synchronous read for callers that cannot await (the upload path awaits; this is for probes). */
export function readRenderSync(dir: string, filename: string): Uint8Array {
  return new Uint8Array(readFileSync(join(dir, safeImageName(filename))))
}

/** Synchronous save, used only by tests and scripts. */
export function saveRenderSync(dir: string, filename: string, bytes: Uint8Array): string {
  const file = safeImageName(filename)
  mkdirSync(dir, { recursive: true })
  const target = join(dir, file)
  const temp = tempName(dir, file)
  writeFileSync(temp, bytes)
  renameSync(temp, target)
  return file
}
