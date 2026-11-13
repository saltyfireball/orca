import { describe, expect, it } from 'vitest'
import { FORK_RELEASE_REPO } from './fork-release-repo'
import {
  FORK_SYNC_STATUS_URL,
  forkSyncNotice,
  forkSyncNoticeEnabled,
  forkSyncNoticeStaleDays,
  parseForkSyncStatus
} from './fork-sync-status'

const RUN = `https://github.com/${FORK_RELEASE_REPO}/actions/runs/123`
const CHECKED = '2026-11-13T09:30:00.000Z'
const NOW = Date.parse(CHECKED) + 60_000

/** What config/scripts/fork/fork-sync-status.mjs writes for a conflict. */
const CONFLICT_FIXTURE = {
  schema: 1,
  state: 'conflict',
  reason: 'Rebasing the fork commits onto v1.4.260 stopped on conflicts.',
  upstreamVersion: '1.4.260',
  upstreamSha: 'b'.repeat(40),
  forkBaseVersion: '1.4.258',
  forkBaseSha: 'a'.repeat(40),
  conflicts: ['src/a.ts', 'src/b.ts'],
  since: '2026-11-10T09:17:00.000Z',
  runUrl: RUN,
  checkedAt: CHECKED
}

describe('FORK_SYNC_STATUS_URL', () => {
  it('derives from the fork release repo', () => {
    expect(FORK_SYNC_STATUS_URL).toBe(
      `https://raw.githubusercontent.com/${FORK_RELEASE_REPO}/fork-sync-status/status.json`
    )
  })
})

describe('parseForkSyncStatus', () => {
  it('reads the workflow fixture', () => {
    expect(parseForkSyncStatus(CONFLICT_FIXTURE)).toEqual({
      state: 'conflict',
      reason: CONFLICT_FIXTURE.reason,
      upstreamVersion: '1.4.260',
      forkBaseVersion: '1.4.258',
      conflicts: ['src/a.ts', 'src/b.ts'],
      since: '2026-11-10T09:17:00.000Z',
      runUrl: RUN,
      checkedAt: CHECKED
    })
  })

  it('refuses another schema, an unknown state or a missing time', () => {
    expect(parseForkSyncStatus({ ...CONFLICT_FIXTURE, schema: 2 })).toBeNull()
    expect(parseForkSyncStatus({ ...CONFLICT_FIXTURE, state: 'fine' })).toBeNull()
    expect(parseForkSyncStatus({ ...CONFLICT_FIXTURE, checkedAt: 'soon' })).toBeNull()
    expect(parseForkSyncStatus('nope')).toBeNull()
    expect(parseForkSyncStatus(null)).toBeNull()
  })

  it('drops a run link that is not a run of the fork repo', () => {
    for (const runUrl of [
      'https://evil.example/actions/runs/1',
      `https://github.com/${FORK_RELEASE_REPO}/actions/runs/1/../../x`,
      `javascript:alert(1)`,
      42
    ]) {
      expect(parseForkSyncStatus({ ...CONFLICT_FIXTURE, runUrl })?.runUrl).toBeNull()
    }
  })

  it('keeps only string conflicts and caps long text', () => {
    const status = parseForkSyncStatus({
      ...CONFLICT_FIXTURE,
      conflicts: ['ok.ts', 7, null, ''],
      reason: 'x'.repeat(1000)
    })
    expect(status?.conflicts).toEqual(['ok.ts'])
    expect(status?.reason).toHaveLength(300)
  })
})

describe('forkSyncNotice', () => {
  const conflict = parseForkSyncStatus(CONFLICT_FIXTURE)
  const inSync = parseForkSyncStatus({ ...CONFLICT_FIXTURE, state: 'in-sync', since: null })

  it('says nothing for an in-sync fork or no status', () => {
    expect(forkSyncNotice(inSync, 3, NOW)).toBeNull()
    expect(forkSyncNotice(null, 3, NOW)).toBeNull()
  })

  it('shows behind, conflict and error states', () => {
    expect(forkSyncNotice(conflict, 3, NOW)?.kind).toBe('conflict')
    for (const state of ['behind', 'error'] as const) {
      const status = parseForkSyncStatus({ ...CONFLICT_FIXTURE, state })
      expect(forkSyncNotice(status, 3, NOW)?.kind).toBe(state)
    }
  })

  it('calls a status stale after the set days, and never with 0', () => {
    const later = Date.parse(CHECKED) + 4 * 24 * 60 * 60 * 1000
    expect(forkSyncNotice(inSync, 3, later)).toMatchObject({ kind: 'stale', staleDays: 4 })
    expect(forkSyncNotice(inSync, 7, later)).toBeNull()
    expect(forkSyncNotice(inSync, 0, later)).toBeNull()
  })
})

describe('settings', () => {
  it('turns the notice on unless switched off', () => {
    expect(forkSyncNoticeEnabled(undefined)).toBe(true)
    expect(forkSyncNoticeEnabled({})).toBe(true)
    expect(forkSyncNoticeEnabled({ forkSyncNotice: false })).toBe(false)
  })

  it('reads the stale days with a default of 3', () => {
    expect(forkSyncNoticeStaleDays({})).toBe(3)
    expect(forkSyncNoticeStaleDays({ forkSyncNoticeStaleDays: 0 })).toBe(0)
    expect(forkSyncNoticeStaleDays({ forkSyncNoticeStaleDays: 7 })).toBe(7)
    expect(forkSyncNoticeStaleDays({ forkSyncNoticeStaleDays: -1 })).toBe(3)
    expect(forkSyncNoticeStaleDays({ forkSyncNoticeStaleDays: 2.5 })).toBe(3)
  })
})
