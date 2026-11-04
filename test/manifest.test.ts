import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import pkg from '../package.json'

describe('bundle manifest', () => {
  test('declares a bundle patch and a web client', () => {
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(pkg.dsh.client.platform).toBe('web')
    expect(pkg.exports['./client']).toEqual({ default: './lib/client.js' })
  })

  test('injects only real client rows', () => {
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-conversation')
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-chat')
    expect(pkg.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-ui-slots')
  })

  test('pins the supported dsh range', () => {
    expect(pkg.engines.dsh).toBe('>=0.2.1-rc.5 <0.3.0')
  })
})

describe('publication hygiene', () => {
  test('the shipped config carries no absolute path from a developer machine', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch).not.toContain('/home/')
    expect(JSON.stringify(pkg)).not.toContain('/home/')
  })

  test('declares the metadata a public package needs', () => {
    expect(pkg.license).toBe('MIT')
    expect(typeof pkg.description).toBe('string')
    expect(pkg.repository.url).toContain('dsh-genui')
  })
})
