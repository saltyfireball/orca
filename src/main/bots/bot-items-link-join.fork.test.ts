// Fork tests (BAD-642): a worker a paired server runs is marked with that server, and its Task's local
// retry's report is not its own. Kept apart from upstream's link-join tests.
import { expect, it, vi } from 'vitest'
import type { IssueInfo, PRInfo } from '../../shared/github/pull-requests/pull-request-types'
import { BotItemLinkJoin } from './bot-items-link-join'
import type { BotItemLinkKind } from '../../shared/bots/bot-items'
import type { BotWorkRuntime } from './bot-work-runtime'
import type { BotWorkWorker } from './bot-work-types'

const worker: BotWorkWorker = {
  dispatchId: 'ctx_1',
  taskId: 'task_1',
  title: 'Fix share dialog',
  agent: 'codex',
  state: 'completed',
  stopped: false,
  startFailed: false,
  host: 'local',
  hostName: null,
  worktreeId: 'repo-1::/wt/share',
  startedAt: 1,
  settledAt: 2
}
// The same Task's earlier attempt on a paired server; a local retry (ctx_1) finished it.
const serverAttempt: BotWorkWorker = { ...worker, dispatchId: 'ctx_srv', host: 'env-1' }
vi.mock('../runtime/orchestration/dock/worker-dock-read', () => ({
  readWorkerDockReasons: () => new Map()
}))
vi.mock('./bot-work-runtime', () => ({
  readWorkers: async (_runtime: unknown, ids: readonly string[]) =>
    new Map(ids.map((id) => [id, id === 'ctx_srv' ? serverAttempt : worker])),
  readWorkspace: async () => ({
    name: 'share',
    branch: 'share',
    head: 'abc',
    pullRequest: {
      number: 9,
      url: pr.url,
      state: 'open',
      checks: 'failure',
      review: null,
      headSha: null
    }
  })
}))

const pr: PRInfo = {
  number: 9,
  title: 'Share dialog',
  state: 'open',
  url: 'https://github.com/acme/app/pull/9',
  checksStatus: 'failure',
  updatedAt: '2026-11-14T00:00:00Z',
  mergeable: 'MERGEABLE'
}
const issue: IssueInfo = {
  number: 7,
  title: 'Viewers can edit',
  state: 'closed',
  url: 'https://github.com/acme/app/issues/7',
  labels: []
}
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: pr and url links never read workers
const join = new BotItemLinkJoin({} as BotWorkRuntime, () => ({
  pr: { 'acme/app#9': { data: pr, fetchedAt: 5 } },
  issue: { 'acme/app#7': { data: issue, fetchedAt: 5 } }
}))
const link = (kind: BotItemLinkKind, ref: string) => ({ itemUid: 'i1', kind, ref, addedEvent: 1 })

it("keeps a server attempt's report empty when a local retry of its Task reported", async () => {
  const runtime = {
    getOrchestrationDb: () => ({ getTask: () => ({ result: '{"subject":"Local result"}' }) })
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: report() reads only getTask
  const withTasks = new BotItemLinkJoin(runtime as unknown as BotWorkRuntime, () => ({
    pr: {},
    issue: {}
  }))
  const reads = await withTasks.readLinkedWorkers(['ctx_1', 'ctx_srv'])
  expect(reads.get('ctx_1')?.report).toEqual({ subject: 'Local result', body: null })
  expect(reads.get('ctx_srv')?.report).toBeNull()
})

it('marks a worker its server runs as its own with that server, and only that worker (BAD-642)', () => {
  const dispatch = link('dispatch', 'ctx_own')
  const owned: BotWorkWorker = { ...serverAttempt, serverOwned: true, worktreeId: null }
  const read = {
    worker: owned,
    pr: { shown: false as const, reason: 'server' as const },
    report: null
  }
  expect(join.linkView(dispatch, read)).toMatchObject({ server: { environmentId: 'env-1' } })
  expect(join.linkView(dispatch, { ...read, worker: serverAttempt })).not.toHaveProperty('server')
  expect(join.linkView(dispatch, { ...read, worker })).not.toHaveProperty('server')
})
