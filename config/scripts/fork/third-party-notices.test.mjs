import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateNotices } from './third-party-notices.mjs'

// Two documents, as pnpm writes them: its own package-manager lock, then the project's.
const LOCKFILE = `---
lockfileVersion: '9.0'
importers:
  .:
    packageManagerDependencies:
      pnpm: {specifier: 1.0.0, version: 1.0.0}
---
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      alpha: {specifier: ^1.0.0, version: 1.0.0(peer-a@2.0.0)}
      local-pkg: {specifier: 'workspace:*', version: link:packages/local}
    devDependencies:
      tool: {specifier: 3.0.0, version: 3.0.0}
packages:
  alpha@1.0.0: {resolution: {integrity: sha512-a}}
  beta@2.0.0: {resolution: {integrity: sha512-b}}
  gamma@1.1.0: {resolution: {integrity: sha512-c}}
  bin-darwin@1.0.0: {resolution: {integrity: sha512-d}, os: [darwin], cpu: [arm64]}
  tool@3.0.0: {resolution: {integrity: sha512-e}}
snapshots:
  alpha@1.0.0(peer-a@2.0.0):
    dependencies:
      beta: 2.0.0
      gamma-alias: gamma@1.1.0
    optionalDependencies:
      bin-darwin: 1.0.0
  beta@2.0.0: {}
  gamma@1.1.0: {}
  bin-darwin@1.0.0: {}
  tool@3.0.0: {}
`

let root
afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
})

/** One package in a pnpm-style store folder, its dependencies linked beside it. */
function storePackage(name, version, files, deps = {}) {
  const storeModules = path.join(root, 'store', `${name}@${version}`, 'node_modules')
  const dir = path.join(storeModules, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version, ...files.manifest })
  )
  for (const [file, text] of Object.entries(files.texts ?? {})) {
    writeFileSync(path.join(dir, file), text)
  }
  for (const [alias, target] of Object.entries(deps)) {
    symlinkSync(target, path.join(storeModules, alias))
  }
  return dir
}

describe('third-party notices generator', () => {
  it('lists the hand notices and each lockfile package reached, grouped by license text', () => {
    root = mkdtempSync(path.join(tmpdir(), 'notices-'))
    writeFileSync(path.join(root, 'pnpm-lock.yaml'), LOCKFILE)
    const mit = 'MIT License\r\n\r\nCopyright (c) Example Beta Authors\r\n'
    const beta = storePackage('beta', '2.0.0', {
      manifest: { license: 'MIT' },
      texts: { LICENSE: mit }
    })
    const gamma = storePackage('gamma', '1.1.0', {
      manifest: { license: 'MIT' },
      texts: { 'LICENSE.md': 'MIT License\n\nCopyright (c) Example Beta Authors' }
    })
    const alpha = storePackage(
      'alpha',
      '1.0.0',
      { manifest: { license: 'ISC' }, texts: { 'LICENCE-ISC': 'ISC License, Example Alpha' } },
      { beta, 'gamma-alias': gamma }
    )
    const tool = storePackage('tool', '2.9.0', { manifest: { license: 'Apache-2.0' } })
    mkdirSync(path.join(root, 'node_modules'))
    symlinkSync(alpha, path.join(root, 'node_modules', 'alpha'))
    symlinkSync(tool, path.join(root, 'node_modules', 'tool'))

    const text = generateNotices(root)
    expect(text).toContain('Copyright (c) 2026 Lovecast Inc.')
    expect(text).toContain('Copyright (c) 2026 T3 Tools Inc.')
    // beta and gamma (reached through an alias) ship the same text once CRLF is normalized.
    const rule = '='.repeat(78)
    expect(text).toContain(
      `beta@2.0.0 (MIT)\ngamma@1.1.0 (MIT)\n${rule}\n\nMIT License\n\nCopyright (c) Example Beta Authors\n`
    )
    expect(text).toContain(`alpha@1.0.0 (ISC)\n${rule}\n\nISC License, Example Alpha\n`)
    expect(text).toContain('bin-darwin@1.0.0 (pulled in by alpha@1.0.0)')
    // The installed tool is another version than the lockfile's, so it is not read.
    expect(text).toMatch(/not installed where this file was generated\n=+\n\ntool@3\.0\.0\n$/)
    expect(text).not.toContain('Apache-2.0')
    expect(text).not.toContain('pnpm@1.0.0')
    expect(text).not.toContain('local-pkg')

    const production = generateNotices(root, { production: true })
    expect(production).not.toContain('tool@3.0.0')
    expect(production).toContain('alpha@1.0.0 (ISC)')
  })
})
