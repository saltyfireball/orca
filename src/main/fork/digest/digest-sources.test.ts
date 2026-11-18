import { describe, expect, it, vi } from 'vitest'
import Database from '../../sqlite/sync-database'
import type { ForkUsageReport } from '../../../shared/fork/usage-report'
import { readForkDigestTasks, parseForkDigestDbTime } from './digest-tasks'
import {
  parseForkDigestPullRequests,
  readForkDigestPullRequests,
  forkDigestPullRequestArgs
} from './digest-pull-requests'
import { readForkDigestLocal, type ForkDigestLocalDeps } from './digest-local'

describe('readForkDigestTasks', () => {
  it('reads tasks that finished or failed in the window, both time formats', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE tasks (id TEXT, task_title TEXT, display_name TEXT, spec TEXT,
      status TEXT, result TEXT, completed_at TEXT)`)
    const insert = db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?)')
    insert.run('a', 'Build', null, 'spec a', 'completed', 'all good', '2026-11-18T03:00:00.000Z')
    insert.run('b', null, null, '\nFix the flaky test\nmore', 'failed', null, '2026-11-18 04:00:00')
    insert.run('c', 'Old', null, 's', 'completed', null, '2026-11-16T03:00:00.000Z')
    insert.run('d', 'Running', null, 's', 'dispatched', null, null)
    const tasks = readForkDigestTasks(db, Date.UTC(2026, 10, 17))
    expect(tasks.map((task) => [task.id, task.title, task.status])).toEqual([
      ['b', 'Fix the flaky test', 'failed'],
      ['a', 'Build', 'completed']
    ])
    expect(tasks[1].result).toBe('all good')
    db.close()
  })

  it('reads SQLite times as UTC', () => {
    expect(parseForkDigestDbTime('2026-11-18 04:00:00')).toBe(Date.UTC(2026, 10, 18, 4))
    expect(parseForkDigestDbTime('')).toBeNull()
  })
})

describe('pull requests', () => {
  const since = Date.UTC(2026, 10, 17)
  const answer = JSON.stringify([
    {
      number: 1,
      title: 'Merged today',
      url: 'https://github.com/o/r/pull/1',
      state: 'MERGED',
      isDraft: false,
      mergedAt: '2026-11-18T01:00:00Z'
    },
    {
      number: 2,
      title: 'Merged last week',
      url: 'https://github.com/o/r/pull/2',
      state: 'MERGED',
      mergedAt: '2026-11-10T01:00:00Z'
    },
    {
      number: 3,
      title: 'Open',
      url: 'https://github.com/o/r/pull/3',
      state: 'OPEN',
      isDraft: true,
      updatedAt: '2026-11-15T01:00:00Z'
    },
    { number: 4, title: 'Closed', url: 'https://github.com/o/r/pull/4', state: 'CLOSED' },
    { number: 5, title: 'Bad url', url: 'http://x', state: 'OPEN' }
  ])

  it('keeps merged in the window and every open one', () => {
    const parsed = parseForkDigestPullRequests(answer, 'r', since)
    expect(parsed?.map((pr) => [pr.number, pr.state, pr.draft])).toEqual([
      [1, 'merged', false],
      [3, 'open', true]
    ])
    expect(parseForkDigestPullRequests('not json', 'r', since)).toBeNull()
  })

  it('asks gh for your own pull requests once per project and counts the ones it could not read', async () => {
    const gh = vi.fn(async (_args: string[], repo: { path: string }) => {
      if (repo.path === '/broken') {
        throw new Error('gh: not logged in')
      }
      return answer
    })
    const result = await readForkDigestPullRequests(
      [
        { name: 'r', path: '/a' },
        { name: 'r', path: '/a' },
        { name: 'r-clone', path: '/b' },
        { name: 'broken', path: '/broken' }
      ],
      since,
      gh
    )
    expect(gh).toHaveBeenCalledTimes(3)
    expect(gh.mock.calls[0][0]).toEqual(forkDigestPullRequestArgs())
    expect(forkDigestPullRequestArgs()).toContain('@me')
    // The clone lists the same pull requests: shown once.
    expect(result.pullRequests).toHaveLength(2)
    expect(result.skipped).toBe(1)
  })
})

function usageReport(): ForkUsageReport {
  const total = {
    key: '',
    label: 'Total',
    chats: 2,
    calls: 4,
    tokens: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0
    },
    totalTokens: 500,
    costUsd: 0.25,
    subscriptionTokens: 0,
    unpricedTokens: 0,
    lastAt: 0
  }
  return { by: 'day', days: 1, generatedAt: 0, rows: [], total }
}

describe('readForkDigestLocal', () => {
  const base: ForkDigestLocalDeps = {
    now: () => Date.UTC(2026, 10, 18, 9),
    tasks: () => [],
    pullRequests: async () => ({ pullRequests: [], skipped: 0 }),
    inbox: async () => ({ now: 0, mode: 'inbox', items: [] }),
    usage: () => usageReport()
  }

  it('reads every source and leaves out paused chats', async () => {
    const section = await readForkDigestLocal(
      {
        ...base,
        inbox: async () => ({
          now: 0,
          mode: 'inbox',
          items: [
            {
              chatId: 'c1',
              kind: 'chat',
              agent: 'claude',
              title: 'T',
              workspace: 'w',
              worktreeId: null,
              verdict: 'waiting_user',
              question: 'Go?',
              reason: '',
              since: 1,
              wakes: 0,
              wakeAt: null,
              paused: false
            },
            {
              chatId: 'c2',
              kind: 'chat',
              agent: 'claude',
              title: 'P',
              workspace: 'w',
              worktreeId: null,
              verdict: 'stalled',
              question: '',
              reason: 'stopped',
              since: 1,
              wakes: 0,
              wakeAt: null,
              paused: true
            },
            {
              chatId: 'o/r#9',
              kind: 'chat',
              agent: 'claude',
              title: 'PR 9',
              workspace: 'w',
              worktreeId: null,
              verdict: 'waiting_user',
              question: 'CI still red after 3 fixes',
              reason: '',
              since: 2,
              wakes: 0,
              wakeAt: null,
              paused: false,
              source: 'babysit',
              prKey: 'github.com/o/r#9'
            }
          ]
        })
      },
      { since: Date.UTC(2026, 10, 17, 9) }
    )
    expect(section.waiting.map((row) => row.chatId)).toEqual(['c1', 'o/r#9'])
    expect(section.waiting[1].source).toBe('babysit')
    expect(section.cost).toMatchObject({ days: 2, costUsd: 0.25, chats: 2 })
    expect(section.notes).toEqual([])
  })

  it('notes a failing source and goes on; no ledger means no cost', async () => {
    const pullRequests = vi.fn(async () => ({ pullRequests: [], skipped: 0 }))
    const section = await readForkDigestLocal(
      {
        ...base,
        tasks: () => {
          throw new Error('no db')
        },
        pullRequests,
        inbox: async () => ({ now: 0, mode: 'off', items: [] }),
        usage: () => {
          throw new Error('no ledger')
        }
      },
      { since: 0, pullRequests: false }
    )
    expect(pullRequests).not.toHaveBeenCalled()
    expect(section.cost).toBeNull()
    expect(section.notes).toHaveLength(2)
  })
})
