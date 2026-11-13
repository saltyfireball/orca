import { describe, expect, it } from 'vitest'
import { baseRecordFor, composeStatus, inputFromEnv, summaryMarkdown } from './fork-sync-status.mjs'

const NOW = '2026-11-13T09:30:00.000Z'
const OLD = 'a'.repeat(40)
const NEW = 'b'.repeat(40)
const MAIN = 'c'.repeat(40)

function input(env) {
  return inputFromEnv({
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'someone/orca',
    GITHUB_RUN_ID: '42',
    UPSTREAM_URL: 'https://github.com/upstream/orca.git',
    LATEST: 'v1.4.260',
    LATEST_SHA: NEW,
    BASE_SHA: OLD,
    BASE_VERSION: '1.4.258',
    BASE_SOURCE: 'record',
    DETECT_STATE: 'behind',
    OLD_MAIN: MAIN,
    ...env
  })
}

describe('composeStatus', () => {
  it('says so when the rebase failed before any conflict', () => {
    const run = input({ SYNC_RESULT: 'failure', REBASE_ERROR: 'true' })
    const status = composeStatus(run, null, NOW)
    expect(status).toMatchObject({ state: 'behind', forkBaseSha: OLD, conflicts: [] })
    expect(status.reason).toMatch(/failed before any conflict/)
    expect(baseRecordFor(run)).toBe('')
  })

  it('reports a successful sync as in sync on the new tag and records it', () => {
    const run = input({ SYNC_RESULT: 'success', CHANGED: 'true', BUILD_RESULTS: 'success success' })
    const status = composeStatus(run, null, NOW)
    expect(status).toMatchObject({
      schema: 1,
      state: 'in-sync',
      reason: null,
      upstreamVersion: '1.4.260',
      forkBaseVersion: '1.4.260',
      forkBaseSha: NEW,
      since: null,
      runUrl: 'https://github.com/someone/orca/actions/runs/42',
      checkedAt: NOW
    })
    expect(baseRecordFor(run)).toBe(NEW)
  })

  it('reports a conflict with its files, keeps the base and records nothing', () => {
    const run = input({
      SYNC_RESULT: 'failure',
      CONFLICT: 'true',
      CONFLICTS: 'src/a.ts\nsrc/b c.ts\n',
      BUILD_RESULTS: 'skipped'
    })
    const status = composeStatus(run, null, NOW)
    expect(status).toMatchObject({
      state: 'conflict',
      upstreamVersion: '1.4.260',
      forkBaseVersion: '1.4.258',
      forkBaseSha: OLD,
      conflicts: ['src/a.ts', 'src/b c.ts'],
      since: NOW
    })
    expect(baseRecordFor(run)).toBe('')
  })

  it('keeps the first failure time across failed runs and clears it once in sync', () => {
    const earlier = { state: 'conflict', since: '2026-11-10T09:17:00.000Z' }
    const failed = composeStatus(input({ SYNC_RESULT: 'failure', CHANGED: 'true' }), earlier, NOW)
    expect(failed).toMatchObject({ state: 'behind', since: earlier.since })
    expect(failed.reason).toMatch(/checks or the push failed/)
    const fixed = composeStatus(input({ SYNC_RESULT: 'success', CHANGED: 'true' }), failed, NOW)
    expect(fixed.since).toBeNull()
  })

  it('calls an early failure an error, and a failed build after a good sync an error', () => {
    const early = composeStatus(
      input({ SYNC_RESULT: 'failure', LATEST: '', LATEST_SHA: '' }),
      null,
      NOW
    )
    expect(early).toMatchObject({ state: 'error', upstreamVersion: null })
    const build = composeStatus(
      input({ SYNC_RESULT: 'success', DETECT_STATE: 'in-sync', BUILD_RESULTS: 'success,failure' }),
      null,
      NOW
    )
    expect(build).toMatchObject({ state: 'error', forkBaseVersion: '1.4.260' })
    expect(build.reason).toMatch(/release build failed/)
  })

  it('records the base of a run that found main already on the newest tag', () => {
    const run = input({ SYNC_RESULT: 'success', DETECT_STATE: 'in-sync', BASE_SHA: NEW })
    expect(baseRecordFor(run)).toBe(NEW)
    expect(baseRecordFor(input({ SYNC_RESULT: 'failure', DETECT_STATE: 'in-sync' }))).toBe('')
  })

  it('passes on the detect error for a tag that moved below the base', () => {
    const run = input({
      SYNC_RESULT: 'failure',
      DETECT_STATE: 'error',
      DETECT_ERROR: 'Upstream v1.4.260 now points at a commit older than the fork base.'
    })
    expect(composeStatus(run, null, NOW)).toMatchObject({
      state: 'error',
      reason: 'Upstream v1.4.260 now points at a commit older than the fork base.'
    })
  })
})

describe('summaryMarkdown', () => {
  it('gives the exact resync commands for a conflict', () => {
    const run = input({ SYNC_RESULT: 'failure', CONFLICT: 'true', CONFLICTS: 'src/a.ts' })
    const text = summaryMarkdown(composeStatus(run, null, NOW), run)
    expect(text).toContain('## Fork sync: conflict')
    expect(text).toContain('- `src/a.ts`')
    expect(text).toContain(`git branch fork-sync-backup-42 ${MAIN}`)
    expect(text).toContain(`git rebase --onto ${NEW} ${OLD} main`)
    expect(text).toContain(`git log --format='%G? %h %s' ${NEW}..main`)
    expect(text).toContain(`git push --force-with-lease=main:${MAIN} origin main`)
    expect(text).toContain('https://github.com/upstream/orca.git "+refs/tags/v1.4.260:')
  })

  it('has no commands when the fork is in sync or the failure needs a look first', () => {
    const ok = input({ SYNC_RESULT: 'success', CHANGED: 'true' })
    expect(summaryMarkdown(composeStatus(ok, null, NOW), ok)).not.toContain('git rebase')
    const odd = input({ SYNC_RESULT: 'failure', DETECT_STATE: 'error' })
    expect(summaryMarkdown(composeStatus(odd, null, NOW), odd)).not.toContain('git rebase')
  })
})
