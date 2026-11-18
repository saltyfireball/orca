import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FORK_WORKTREE_PORTS_FILE, ForkWorktreePortRegistry } from './worktree-port-registry'
import {
  applyForkWorktreePortEnv,
  forkWorktreePortKeep,
  forkWorktreePortSetupEnvFor,
  forkWorktreePortsLifecycle,
  readForkWorktreePortBlock,
  setForkWorktreePortsForTests,
  startForkWorktreePorts,
  withForkWorktreePortEnv
} from './worktree-ports-service'
import { stampPtySpawnPaneEnv } from '../../ipc/pty/host-env/spawn-pane-env'
import { getSetupEnvVars } from '../../workspace-hooks/setup-hook-env-vars'

let dir: string
let settings: Record<string, unknown>
let registry: ForkWorktreePortRegistry

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fork-worktree-ports-service-'))
  settings = { forkWorktreePortsCount: 3 }
  registry = new ForkWorktreePortRegistry(join(dir, FORK_WORKTREE_PORTS_FILE), async () => true)
  setForkWorktreePortsForTests(registry, () => settings)
})

afterEach(() => {
  setForkWorktreePortsForTests(null)
  rmSync(dir, { recursive: true, force: true })
})

describe('worktree port env', () => {
  it('stamps a terminal with its workspace block and drops stale names', () => {
    const env: Record<string, string> = { ORCA_PORT: '1', ORCA_PORT_7: '8', KEEP: 'x' }
    applyForkWorktreePortEnv(env, 'repo::/w/a')
    expect(env).toEqual({
      KEEP: 'x',
      ORCA_PORT: '20000',
      ORCA_PORT_COUNT: '3',
      ORCA_PORT_0: '20000',
      ORCA_PORT_1: '20001',
      ORCA_PORT_2: '20002'
    })
  })

  it('reaches terminals through the pane stamp and setup scripts through the hook env', () => {
    const env: Record<string, string> = {}
    stampPtySpawnPaneEnv(env, {
      pane: { paneKey: 'tab:leaf', tabId: 'tab', worktreeId: 'repo::/w/a' },
      jcodeRuntimeDir: undefined
    })
    expect(env.ORCA_PORT).toBe('20000')
    const setup = getSetupEnvVars({ path: '/w/repo' }, '/w/a', {
      worktreeId: 'repo::/w/a'
    })
    expect(setup).toMatchObject({
      ORCA_PORT: '20000',
      ORCA_PORT_2: '20002',
      CONDUCTOR_PORT: '20000'
    })
    // A hook env with no workspace (the environment doctor) gets no block.
    expect(getSetupEnvVars({ path: '/w/repo' }, '/w/a').ORCA_PORT).toBeUndefined()
  })

  it('exports nothing and reserves nothing when off or without a workspace', () => {
    settings = { forkWorktreePorts: false }
    const env: Record<string, string> = { ORCA_PORT: '1' }
    applyForkWorktreePortEnv(env, 'repo::/w/a')
    expect(env).toEqual({})
    expect(forkWorktreePortSetupEnvFor('repo::/w/a')).toEqual({})
    settings = {}
    expect(withForkWorktreePortEnv({ A: '1' }, undefined)).toEqual({ A: '1' })
    expect(registry.list()).toEqual([])
    expect(readForkWorktreePortBlock('repo::/w/a')).toEqual({ enabled: true, block: null })
  })

  it('does nothing in a process that never installed the feature', () => {
    setForkWorktreePortsForTests(registry, null)
    const env: Record<string, string> = {}
    applyForkWorktreePortEnv(env, 'repo::/w/a')
    forkWorktreePortsLifecycle({ kind: 'created', worktreeId: 'repo::/w/a' })
    expect(env).toEqual({})
    expect(registry.list()).toEqual([])
    expect(readForkWorktreePortBlock('repo::/w/a')).toEqual({ enabled: false, block: null })
  })

  it('reserves on create, releases on remove, and reading never reserves', () => {
    forkWorktreePortsLifecycle({ kind: 'created', worktreeId: 'repo::/w/a' })
    expect(readForkWorktreePortBlock('repo::/w/a').block?.start).toBe(20000)
    forkWorktreePortsLifecycle({ kind: 'removed', worktreeId: 'repo::/w/a' })
    forkWorktreePortsLifecycle({ kind: 'removed', worktreeId: 'repo::/w/a' })
    expect(readForkWorktreePortBlock('repo::/w/a').block).toBeNull()
    expect(registry.list()).toEqual([])
  })
})

describe('forkWorktreePortKeep', () => {
  const local = { id: 'repo', path: '/w/repo' }
  const exists = (paths: string[]) => async (path: string) => paths.includes(path)

  it('drops a block whose project is gone or whose local folder is gone', async () => {
    expect(await forkWorktreePortKeep([], 'repo::/w/a', exists([]))).toBe(false)
    expect(await forkWorktreePortKeep([local], 'repo::/w/a', exists(['/w/repo']))).toBe(false)
    expect(await forkWorktreePortKeep([local], 'repo::/w/a', exists(['/w/repo', '/w/a']))).toBe(
      true
    )
  })

  it('keeps what it cannot prove gone', async () => {
    // The project folder itself is unreadable (unmounted drive, WSL distro down).
    expect(await forkWorktreePortKeep([local], 'repo::/w/a', exists([]))).toBe(true)
    const ssh = { ...local, executionHostId: 'ssh:box' }
    expect(await forkWorktreePortKeep([ssh], 'repo::/w/a', exists(['/w/repo']))).toBe(true)
    expect(await forkWorktreePortKeep([], 'folder:abc', exists([]))).toBe(true)
  })

  it('prunes at settle and then follows removals', async () => {
    registry.reserve('repo::/gone', { count: 3, from: 20000, to: 29999 })
    registry.reserve('other::/w/b', { count: 3, from: 20000, to: 29999 })
    let listener: ((event: { kind: 'created' | 'removed'; worktreeId: string }) => void) | null =
      null
    const runtime = {
      onWorktreeLifecycle: vi.fn((next: NonNullable<typeof listener>) => {
        listener = next
        return () => {}
      }),
      requireStore: () => ({ getRepos: () => [{ id: 'other', path: '/nowhere-on-this-host' }] })
    }
    await startForkWorktreePorts(runtime)
    await startForkWorktreePorts(runtime)
    expect(runtime.onWorktreeLifecycle).toHaveBeenCalledTimes(1)
    expect(registry.list().map((block) => block.worktreeId)).toEqual(['other::/w/b'])
    listener!({ kind: 'removed', worktreeId: 'other::/w/b' })
    expect(registry.list()).toEqual([])
  })
})
