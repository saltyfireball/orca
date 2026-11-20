// Worker archive's read of the workspaces worker starts created, over an in-memory database.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { listWorkerWorkspaceRecords } from './worker-archive-query'

let db: OrchestrationDb
const WT = 'repo::/wt/a'

function dispatch(
  id: string,
  over: {
    state?: string
    worktree?: string
    created?: boolean
    release?: string
    reason?: string
  } = {}
): void {
  const worktree = over.worktree ?? WT
  const effects =
    over.created === false ? [] : [{ kind: 'worktree', action: 'created_child', id: worktree }]
  db.db
    .prepare(
      `INSERT INTO worker_dispatches (dispatch_id, state, worktree_id, effects, updated_at)
       VALUES (?, ?, ?, ?, '2026-01-02 03:00:00')`
    )
    .run(`d-${id}`, over.state ?? 'succeeded', worktree, JSON.stringify(effects))
  db.db
    .prepare(
      `INSERT INTO worker_terminal_resources
         (id, origin_dispatch_id, owner_dispatch_id, worktree_id, terminal_handle, pane_key,
          release_state, retained_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-01-02 02:00:00')`
    )
    .run(
      `r-${id}`,
      `d-${id}`,
      `d-${id}`,
      worktree,
      `t-${id}`,
      `tab:${id}`,
      over.release ?? 'released',
      over.reason ?? null
    )
}

function report(id: string): void {
  db.db
    .prepare(
      `INSERT INTO messages (id, from_handle, to_handle, subject, type, payload, read, created_at)
       VALUES (?, ?, 'coordinator', 'done', 'worker_done', '{}', 1, '2026-01-02 03:04:05')`
    )
    .run(`m-${id}`, `dispatch:d-${id}`)
}

beforeEach(() => {
  db = new OrchestrationDb(':memory:')
  db.db.exec('PRAGMA foreign_keys = OFF')
})

afterEach(() => {
  db.close()
})

describe('listWorkerWorkspaceRecords', () => {
  it('lists a workspace a worker start created, with its report time', () => {
    dispatch('a')
    report('a')
    const [record] = listWorkerWorkspaceRecords(db)
    expect(record?.worktreeId).toBe(WT)
    expect(record?.dispatches).toMatchObject([
      {
        dispatchId: 'd-a',
        state: 'succeeded',
        finishedAtMs: Date.parse('2026-01-02T03:04:05Z'),
        keptOpen: false,
        takenOver: false,
        paneKey: 'tab:a'
      }
    ])
  })

  it('never lists a workspace the worker only ran in', () => {
    dispatch('b', { created: false })
    expect(listWorkerWorkspaceRecords(db)).toEqual([])
  })

  it('marks a worker the user kept open, and one whose terminal was handed on', () => {
    dispatch('c', { release: 'retained', reason: 'user_kept' })
    expect(listWorkerWorkspaceRecords(db)[0]?.dispatches[0]?.keptOpen).toBe(true)
    db.db
      .exec(`UPDATE worker_terminal_resources SET release_state = 'released', retained_reason = NULL,
                ownership_state = 'user_owned'`)
    expect(listWorkerWorkspaceRecords(db)[0]?.dispatches[0]).toMatchObject({
      keptOpen: false,
      takenOver: true
    })
  })

  it('groups every dispatch that used the workspace', () => {
    dispatch('d')
    dispatch('e', { state: 'ready', created: false })
    expect(
      listWorkerWorkspaceRecords(db)[0]
        ?.dispatches.map((entry) => entry.state)
        .sort()
    ).toEqual(['ready', 'succeeded'])
  })
})
