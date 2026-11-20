// BAD-669: the `orca orchestration worker-cleanup` table and the call it makes for --dry-run.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ForkWorkerCleanupResult,
  ForkWorkerCleanupRow
} from '../../shared/fork/worker-archive'
import { FORK_WORKER_CLEANUP_HANDLERS, formatWorkerCleanup } from './worker-cleanup-handlers'

function row(over: Partial<ForkWorkerCleanupRow>): ForkWorkerCleanupRow {
  return {
    worktreeId: 'repo::/w/a',
    name: 'otter',
    branch: 'BAD-1-otter',
    path: '/w/a',
    botName: 'Cassandra',
    finishedAtMs: 0,
    outcome: 'remove',
    canForce: false,
    ...over
  }
}

function result(over: Partial<ForkWorkerCleanupResult>): ForkWorkerCleanupResult {
  return { dryRun: true, enabled: true, rows: [], servers: [], ...over }
}

afterEach(() => vi.restoreAllMocks())

describe('formatWorkerCleanup', () => {
  it('says when there is nothing to clean up', () => {
    expect(formatWorkerCleanup(result({}))).toBe(
      'No finished worker workspaces found.\nDry run: 0 would be removed. Nothing was changed.'
    )
  })

  it('lists what would be removed and what is skipped with why, on this machine and a server', () => {
    const text = formatWorkerCleanup(
      result({
        rows: [
          row({}),
          row({
            name: 'fox',
            path: '/w/b',
            outcome: 'skip',
            reason: 'unmerged-commits',
            unlandedCommits: 2,
            canForce: true
          })
        ],
        servers: [
          { name: 'kif', ok: true, rows: [row({ name: 'heron', path: '/s/c', server: 'kif' })] },
          { name: 'roberto', ok: false, error: 'timed out', rows: [] }
        ]
      })
    )
    const lines = text.split('\n')
    expect(lines[0]).toMatch(/^would remove\s+Cassandra\s+otter\s+BAD-1-otter\s+\/w\/a$/)
    expect(lines[1]).toContain('skipped: unmerged commits (2 not on a base branch)')
    expect(lines[2]).toContain('kif: /s/c')
    expect(lines[3]).toBe('Note: roberto: not cleaned up: timed out')
    expect(lines[4]).toBe('Dry run: 2 would be removed. Nothing was changed.')
  })

  it('says removed once it ran, and that branches were kept', () => {
    expect(formatWorkerCleanup(result({ dryRun: false, rows: [row({})] }))).toMatch(
      /^removed .*\n1 removed\. Git branches were kept\.$/
    )
  })
})

describe('worker-cleanup command', () => {
  it('asks the host for a dry run and prints the table', async () => {
    const call = vi.fn(async () => ({ result: result({ rows: [row({})] }) }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const handler = FORK_WORKER_CLEANUP_HANDLERS['orchestration worker-cleanup']
    await handler({
      flags: new Map<string, string | boolean>([
        ['dry-run', true],
        ['include-remote', true],
        ['bot', 'cassandra']
      ]),
      json: false,
      client: { call }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only these fields.
    } as never)
    expect(call).toHaveBeenCalledWith('fork.workerCleanup.run', {
      bot: 'cassandra',
      dryRun: true,
      includeRemote: true
    })
    expect(log.mock.calls.join('\n')).toContain('would remove')
  })
})
