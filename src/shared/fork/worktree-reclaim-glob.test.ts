import { describe, expect, it } from 'vitest'
import { compileReclaimMatcher, normalizeReclaimGlobs } from './worktree-reclaim-glob'

describe('reclaim globs', () => {
  it('matches a bare name at any depth and anything inside it', () => {
    const matches = compileReclaimMatcher(['node_modules'])
    expect(matches('node_modules/')).toBe(true)
    expect(matches('packages/a/node_modules')).toBe(true)
    expect(matches('packages/a/node_modules/x/y.js')).toBe(true)
    expect(matches('src/node_modules_notes.md')).toBe(false)
    expect(matches('.env')).toBe(false)
  })

  it('anchors a pattern with a slash at the root', () => {
    const matches = compileReclaimMatcher(['apps/*/dist', 'tmp/**/cache'])
    expect(matches('apps/web/dist')).toBe(true)
    expect(matches('other/apps/web/dist')).toBe(false)
    expect(matches('tmp/a/b/cache')).toBe(true)
  })

  it('refuses patterns that would match every ignored path or leave the worktree', () => {
    expect(
      normalizeReclaimGlobs(['*', '**', '../x', '/etc', 'a/../b', '.git', 'x/.git/y', 'C:\\x', ''])
    ).toEqual([])
    expect(normalizeReclaimGlobs(['./dist/', 'dist', '*.pyc'])).toEqual(['dist', '*.pyc'])
  })
})

describe('orca.yaml worktree.reclaim', () => {
  it('reads safe globs and drops unsafe ones', async () => {
    const { parseOrcaYaml } = await import('../workspace-setup/orca-yaml')
    const hooks = parseOrcaYaml(
      'worktree:\n  reclaim:\n    - node_modules\n    - "*"\n    - ../x\n    - apps/*/dist\n'
    )
    expect(hooks?.worktree?.reclaim).toEqual(['node_modules', 'apps/*/dist'])
  })
})
