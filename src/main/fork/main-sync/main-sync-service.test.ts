// SLRM-2384: the keep main current timer and pass, with a stub git that records what it is asked.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repository/repo-types'
import {
  MainSyncService,
  MAIN_SYNC_IDLE_RECHECK_MS,
  MAIN_SYNC_SETTINGS_CHANGE_DELAY_MS,
  type MainSyncSettings
} from './main-sync-service'
import type { MainSyncGit } from './main-sync-repo'

function repo(id: string, extra: Partial<Repo> = {}): Repo {
  return { id, path: `/nowhere/${id}`, displayName: id, badgeColor: '', addedAt: 0, ...extra }
}

function service(settings: MainSyncSettings, repos: Repo[], log: string[] = []) {
  const asked: string[] = []
  const git: MainSyncGit = async (args, options) => {
    asked.push(`${options.cwd}: ${args.join(' ')}`)
    throw new Error('stub git: no repository')
  }
  const svc = new MainSyncService({
    readSettings: () => settings,
    listRepos: () => repos,
    git,
    pathExists: async () => false,
    now: () => 5_000,
    log: (message) => log.push(message)
  })
  return { svc, asked }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MainSyncService', () => {
  it('runs nothing while off, and looks at the settings again later', async () => {
    vi.useFakeTimers()
    const { svc, asked } = service({}, [repo('a')])
    svc.start(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(asked).toEqual([])
    expect(svc.status()).toMatchObject({ enabled: false, nextRunAt: null, lastRunAt: null })
    await vi.advanceTimersByTimeAsync(MAIN_SYNC_IDLE_RECHECK_MS)
    expect(asked).toEqual([])
    svc.stop()
  })

  it('passes over local git projects the settings name, skipping folder and remote ones', async () => {
    const log: string[] = []
    const repos = [
      repo('a'),
      repo('b'),
      repo('folder', { kind: 'folder' }),
      repo('ssh', { connectionId: 'build-box' })
    ]
    const { svc } = service(
      { forkMainSync: true, forkMainSyncProjects: ['a', 'folder', 'ssh'] },
      repos,
      log
    )
    const results = await svc.run()
    expect(results.map((result) => [result.repoId, result.reason])).toEqual([
      ['a', 'missing-folder']
    ])
    expect(log).toEqual(['[fork-main-sync] "a": skipped (missing-folder)'])
    // The same reason again is not logged twice.
    await svc.run()
    expect(log).toHaveLength(1)
    expect(svc.status()).toMatchObject({
      enabled: true,
      intervalMinutes: 15,
      projects: ['a', 'folder', 'ssh'],
      lastRunAt: 5_000,
      results: [expect.objectContaining({ repoId: 'a' })]
    })
  })

  it('runs one named project on demand, even while off', async () => {
    const { svc } = service({}, [repo('a'), repo('b')])
    const results = await svc.run('b')
    expect(results.map((result) => result.repoId)).toEqual(['b'])
  })

  it('joins a pass already under way', async () => {
    const { svc } = service({ forkMainSync: true }, [repo('a')])
    const first = svc.run()
    expect(svc.run()).toBe(first)
    await first
  })

  it('waits for a settings change while off, then runs soon after it is turned on', async () => {
    vi.useFakeTimers()
    const settings: MainSyncSettings = {}
    const heard: { listener?: (updates: { forkMainSync?: boolean }) => void } = {}
    const ran: string[] = []
    const svc = new MainSyncService({
      readSettings: () => settings,
      listRepos: () => [repo('a')],
      git: async () => '',
      pathExists: async () => false,
      onSettingsChanged: (next) => {
        heard.listener = next
      },
      log: (message) => ran.push(message)
    })
    svc.start(0)
    await vi.advanceTimersByTimeAsync(10 * MAIN_SYNC_IDLE_RECHECK_MS)
    expect(ran).toEqual([])
    settings.forkMainSync = true
    heard.listener?.({ forkMainSync: true })
    await vi.advanceTimersByTimeAsync(MAIN_SYNC_SETTINGS_CHANGE_DELAY_MS)
    expect(ran).toEqual(['[fork-main-sync] "a": skipped (missing-folder)'])
    svc.stop()
  })

  it('falls back to 15 minutes for an interval out of range', () => {
    const { svc } = service({ forkMainSync: true, forkMainSyncMinutes: 1 }, [])
    expect(svc.status().intervalMinutes).toBe(15)
  })
})
