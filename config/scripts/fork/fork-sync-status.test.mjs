import { describe, expect, it } from 'vitest'
import { composeStatus, inputFromEnv, summaryMarkdown } from './fork-sync-status.mjs'

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
    BASE_SOURCE: 'newest upstream tag merged into main',
    DETECT_STATE: 'behind',
    OLD_MAIN: MAIN,
    ...env
  })
}

describe('composeStatus', () => {
  it('says so when the merge failed before any conflict', () => {
    const run = input({ SYNC_RESULT: 'failure', MERGE_ERROR: 'true' })
    const status = composeStatus(run, null, NOW)
    expect(status).toMatchObject({
      state: 'behind',
      forkBaseSha: OLD,
      conflicts: []
    })
    expect(status.reason).toMatch(/failed before any conflict/)
  })

  it('reports a successful sync as in sync on the new tag ', () => {
    const run = input({
      SYNC_RESULT: 'success',
      CHANGED: 'true',
      BUILD_RESULTS: 'success success'
    })
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
  })

  it('reports a conflict with its files, keeps the base', () => {
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
      input({
        SYNC_RESULT: 'success',
        DETECT_STATE: 'in-sync',
        BUILD_RESULTS: 'success,failure'
      }),
      null,
      NOW
    )
    expect(build).toMatchObject({ state: 'error', forkBaseVersion: '1.4.260' })
    expect(build.reason).toMatch(/release build failed/)
  })

  it('passes on a detect error', () => {
    const run = input({
      SYNC_RESULT: 'failure',
      DETECT_STATE: 'error',
      DETECT_ERROR: 'No stable upstream tag is merged into main.'
    })
    expect(composeStatus(run, null, NOW)).toMatchObject({
      state: 'error',
      reason: 'No stable upstream tag is merged into main.'
    })
  })
})

describe('summaryMarkdown', () => {
  it('starts a conflict summary with the marker and gives the by-hand merge commands', () => {
    const run = input({
      SYNC_RESULT: 'failure',
      CONFLICT: 'true',
      CONFLICTS: 'src/a.ts'
    })
    const text = summaryMarkdown(composeStatus(run, null, NOW), run)
    expect(text.split('\n')[0]).toBe('FORK-SYNC-CONFLICT v1.4.260')
    expect(text.match(/FORK-SYNC-CONFLICT/g)).toHaveLength(1)
    expect(text).toContain('## Fork sync: conflict')
    expect(text).toContain('- `src/a.ts`')
    expect(text).toContain(`git switch -c fork-sync-v1.4.260 origin/main   # main was ${MAIN}`)
    expect(text).toContain('git merge v1.4.260')
    expect(text).toContain('git push origin fork-sync-v1.4.260:main')
    expect(text).not.toMatch(/--force|rebase/)
    expect(text).toContain('https://github.com/upstream/orca.git "+refs/tags/v1.4.260:')
  })

  it('has no commands and no marker when the fork is in sync or the failure needs a look first', () => {
    const ok = input({ SYNC_RESULT: 'success', CHANGED: 'true' })
    expect(summaryMarkdown(composeStatus(ok, null, NOW), ok)).not.toContain('git merge')
    const odd = input({ SYNC_RESULT: 'failure', DETECT_STATE: 'error' })
    expect(summaryMarkdown(composeStatus(odd, null, NOW), odd)).not.toContain('git merge')
  })
})
