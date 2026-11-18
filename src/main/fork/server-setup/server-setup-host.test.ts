import { describe, expect, it, vi } from 'vitest'
import type { EnvironmentDoctorResult } from '../../../shared/workspace-setup/environment-doctor/environment-doctor-types'
import {
  expandForkSetupParent,
  planForkServerSetup,
  readForkServerSetupReadiness,
  type ForkServerSetupHostDeps
} from './server-setup-host'

const HOME = '/home/me'

describe('expandForkSetupParent', () => {
  it("expands ~ against this machine's home and keeps absolute folders", () => {
    expect(expandForkSetupParent('~', HOME)).toBe(HOME)
    expect(expandForkSetupParent('~/development', HOME)).toBe('/home/me/development')
    expect(expandForkSetupParent('~/a/../b', HOME)).toBe('/home/me/b')
    expect(expandForkSetupParent('/srv/code', HOME)).toBe('/srv/code')
  })

  it('refuses relative folders, other homes and a missing home', () => {
    expect(expandForkSetupParent('development', HOME)).toBeNull()
    expect(expandForkSetupParent('~root', HOME)).toBeNull()
    expect(expandForkSetupParent('~/x', '')).toBeNull()
  })
})

describe('planForkServerSetup', () => {
  it('names the clone folder from the URL and says whether it is taken', async () => {
    const exists = vi.fn(async () => false)
    const plan = await planForkServerSetup(
      { url: 'git@github.com:owner/repo.git', parent: '~/development' },
      { home: () => HOME, exists }
    )
    expect(plan).toEqual({
      destination: '/home/me/development',
      folderName: 'repo',
      clonePath: '/home/me/development/repo',
      exists: false
    })
    expect(exists).toHaveBeenCalledWith('/home/me/development/repo')
  })

  it('checks the URL again on the server', async () => {
    const exists = vi.fn(async () => false)
    await expect(
      planForkServerSetup({ url: '/etc', parent: '~' }, { home: () => HOME, exists })
    ).rejects.toThrow(/local path/)
    await expect(
      planForkServerSetup({ url: 'ext::sh', parent: '~' }, { home: () => HOME, exists })
    ).rejects.toThrow(/remote helper/)
    expect(exists).not.toHaveBeenCalled()
  })

  it('refuses a relative parent', async () => {
    await expect(
      planForkServerSetup(
        { url: 'https://github.com/o/r.git', parent: 'code' },
        { home: () => HOME, exists: async () => false }
      )
    ).rejects.toThrow(/absolute path/)
  })
})

function doctor(checks: EnvironmentDoctorResult['checks']): EnvironmentDoctorResult {
  return { worktreePath: '/home/me/development/repo', ok: true, checks }
}

function hostDeps(files: Record<string, string>, overrides: Partial<ForkServerSetupHostDeps> = {}) {
  return {
    home: () => HOME,
    exists: async () => true,
    readText: async (path: string) => files[path] ?? null,
    listDir: async (path: string) =>
      path === '/home/me/.config/direnv/lib' ? ['a.sh', 'b.txt'] : [],
    env: () => ({}),
    runDoctor: async () =>
      doctor([
        { id: 'tool.git', category: 'tools', status: 'pass', message: 'git is installed.' },
        {
          id: 'tool.pnpm',
          category: 'tools',
          status: 'fail',
          message: 'pnpm is not on PATH, but package.json needs it.'
        },
        {
          id: 'setup.run',
          category: 'setup',
          status: 'warn',
          message: 'Setup script is configured but has not run here.'
        },
        { id: 'agent.cli', category: 'agents', status: 'warn', message: 'No agent.' }
      ]),
    findCommands: async () => new Set<string>(['direnv']),
    ...overrides
  } satisfies ForkServerSetupHostDeps
}

describe('readForkServerSetupReadiness', () => {
  it('lists missing tools, setup notes and direnv functions from every rc', async () => {
    const readiness = await readForkServerSetupReadiness(
      '/home/me/development/repo',
      hostDeps({
        '/home/me/development/repo/.envrc': 'use secrets app\nuse vault x\n',
        '/home/me/.config/direnv/lib/a.sh': 'use_secrets() { :; }'
      })
    )
    expect(readiness.missing).toEqual([
      'pnpm is not on PATH, but package.json needs it.',
      'direnv function use_vault (for "use vault x" in .envrc)'
    ])
    expect(readiness.notes).toEqual([
      'Setup script is configured but has not run here.',
      '.envrc runs "use secrets app"'
    ])
  })

  it('reads DIRENV_CONFIG when set and skips direnv without an .envrc', async () => {
    const findCommands = vi.fn(async () => new Set<string>())
    const withoutEnvrc = await readForkServerSetupReadiness(
      '/home/me/development/repo',
      hostDeps({}, { findCommands })
    )
    expect(withoutEnvrc.missing).toEqual(['pnpm is not on PATH, but package.json needs it.'])
    expect(findCommands).not.toHaveBeenCalled()

    const readText = vi.fn(async (path: string) =>
      path === '/home/me/development/repo/.envrc'
        ? 'use secrets app'
        : path === '/cfg/direnvrc'
          ? 'use_secrets() {}'
          : null
    )
    const configured = await readForkServerSetupReadiness(
      '/home/me/development/repo',
      hostDeps({}, { readText, env: () => ({ DIRENV_CONFIG: '/cfg' }) })
    )
    expect(configured.missing).toEqual(['pnpm is not on PATH, but package.json needs it.'])
  })

  it('refuses a relative path', async () => {
    await expect(readForkServerSetupReadiness('repo', hostDeps({}))).rejects.toThrow(/absolute/)
  })
})
