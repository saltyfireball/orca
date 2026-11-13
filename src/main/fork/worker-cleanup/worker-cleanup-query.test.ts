// Worker cleanup's candidate query and claim over an in-memory orchestration database.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { claimWorkerCleanupRelease, listWorkerCleanupCandidates } from './worker-cleanup-query'

let db: OrchestrationDb
const DONE = '2026-01-02 03:04:05'
const DONE_MS = Date.parse('2026-01-02T03:04:05Z')

function seed(id: string, dispatchState = 'succeeded', release = 'not_requested'): void {
  db.db
    .prepare(
      `INSERT INTO worker_dispatches (dispatch_id, state, worktree_id, updated_at)
       VALUES (?, ?, 'repo::/wt', '2026-01-02 03:00:00')`
    )
    .run(`d-${id}`, dispatchState)
  db.db
    .prepare(
      `INSERT INTO worker_terminal_resources
         (id, origin_dispatch_id, owner_dispatch_id, worktree_id, terminal_handle, pane_key, release_state)
       VALUES (?, ?, ?, 'repo::/wt', ?, ?, ?)`
    )
    .run(`r-${id}`, `d-${id}`, `d-${id}`, `t-${id}`, `tab:${id}`, release)
}

function report(id: string, read: number, viaPayload = false): void {
  db.db
    .prepare(
      `INSERT INTO messages (id, from_handle, to_handle, subject, type, payload, read, created_at)
       VALUES (?, ?, 'coordinator', 'done', 'worker_done', ?, ?, ?)`
    )
    .run(
      `m-${id}-${read}`,
      viaPayload ? 'term:x' : `dispatch:d-${id}`,
      viaPayload ? JSON.stringify({ dispatchId: `d-${id}` }) : 'not json',
      read,
      DONE
    )
}

beforeEach(() => {
  db = new OrchestrationDb(':memory:')
  db.db.exec('PRAGMA foreign_keys = OFF')
})

afterEach(() => {
  db.close()
})

describe('listWorkerCleanupCandidates', () => {
  it('lists an owned worker whose dispatch finished, with its report time', () => {
    seed('a')
    report('a', 1)
    expect(listWorkerCleanupCandidates(db, 0)).toEqual([
      {
        resourceId: 'r-a',
        dispatchId: 'd-a',
        paneKey: 'tab:a',
        terminalHandle: 't-a',
        worktreeId: 'repo::/wt',
        doneAtMs: DONE_MS,
        unreadReport: false,
        pendingQuestion: false
      }
    ])
  })

  it('finds a report named in its payload, and marks an unread one', () => {
    seed('b')
    report('b', 0, true)
    expect(listWorkerCleanupCandidates(db, 0)[0]?.unreadReport).toBe(true)
  })

  it('skips running, stopped, kept and already released workers', () => {
    seed('run', 'ready')
    seed('stop', 'stopped')
    seed('kept', 'succeeded', 'retained')
    seed('gone', 'succeeded', 'released')
    expect(listWorkerCleanupCandidates(db, 0)).toEqual([])
  })

  it('skips a worker that reported before the given time', () => {
    seed('old')
    report('old', 1)
    expect(listWorkerCleanupCandidates(db, DONE_MS + 1_000)).toEqual([])
    expect(listWorkerCleanupCandidates(db, DONE_MS)).toHaveLength(1)
  })

  it('flags an open question or a pending approval', () => {
    seed('q')
    db.db.exec(`INSERT INTO question_threads (message_id, run_id, dispatch_id, asker_handle)
                VALUES ('qm', 'run', 'd-q', 'x')`)
    seed('g')
    db.db.exec(`INSERT INTO dispatch_contexts (id, task_id) VALUES ('d-g', 'task-g')`)
    db.db.exec(`INSERT INTO decision_gates (id, task_id, question) VALUES ('gate', 'task-g', '?')`)
    const byId = new Map(listWorkerCleanupCandidates(db, 0).map((c) => [c.resourceId, c]))
    expect(byId.get('r-q')?.pendingQuestion).toBe(true)
    expect(byId.get('r-g')?.pendingQuestion).toBe(true)
    db.db.exec(`UPDATE question_threads SET status = 'answered'`)
    db.db.exec(`UPDATE decision_gates SET status = 'resolved'`)
    expect(listWorkerCleanupCandidates(db, 0).some((c) => c.pendingQuestion)).toBe(false)
  })
})

describe('claimWorkerCleanupRelease', () => {
  it('requests the release once, with the automatic-close markers', () => {
    seed('c')
    expect(claimWorkerCleanupRelease(db, 'r-c', DONE_MS)).toBe(true)
    expect(claimWorkerCleanupRelease(db, 'r-c', DONE_MS)).toBe(false)
    const row = db.db
      .prepare(
        `SELECT release_state, auto_release_at, auto_release_dispatch_id
           FROM worker_terminal_resources WHERE id = 'r-c'`
      )
      .get()
    expect(row).toEqual({
      release_state: 'requested',
      auto_release_at: DONE,
      auto_release_dispatch_id: 'd-c'
    })
  })

  it('leaves a kept worker alone', () => {
    seed('k', 'succeeded', 'retained')
    expect(claimWorkerCleanupRelease(db, 'r-k', DONE_MS)).toBe(false)
  })
})
