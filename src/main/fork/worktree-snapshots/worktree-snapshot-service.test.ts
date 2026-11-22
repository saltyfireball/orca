// The removal hook: a snapshot that cannot be written stops a normal delete, never a forced one.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const git = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('../../git/command-runner/git-exec-file', () => ({ gitExecFileAsync: git.run }))

import {
  forkSnapshotBeforeWorktreeRemoval,
  installForkWorktreeSnapshots
} from './worktree-snapshot-service'

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'orca-snapshot-service-'))
  git.run.mockReset()
  git.run.mockRejectedValue(new Error('git is broken'))
})

afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

describe('forkSnapshotBeforeWorktreeRemoval', () => {
  it('aborts the removal with the error when the snapshot fails', async () => {
    installForkWorktreeSnapshots({ getSettings: () => ({}) })
    await expect(forkSnapshotBeforeWorktreeRemoval('/repo', folder, false)).rejects.toThrow(
      /nothing was removed: .*Force the delete/s
    )
  })

  it('lets a forced removal go on when the snapshot fails', async () => {
    installForkWorktreeSnapshots({ getSettings: () => ({}) })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(forkSnapshotBeforeWorktreeRemoval('/repo', folder, true)).resolves.toBeUndefined()
  })

  it('does nothing when the setting is off', async () => {
    installForkWorktreeSnapshots({ getSettings: () => ({ forkWorktreeSnapshots: false }) })
    await forkSnapshotBeforeWorktreeRemoval('/repo', folder, false)
    expect(git.run).not.toHaveBeenCalled()
  })
})
