// BAD-820: the "reviewer could not run" path on a server that owns its workers, through the real
// wiring: the home stores and starts the Task (real task-create, real --on route), the server
// gates the done with the real gate and runs the real reviewer command, which fails in its own
// sandbox. The Decision inbox rows come from the real contract source over the server's database,
// the stop is the database's own stop and the accept is task-update's own status write.
import { afterEach, describe, expect, it } from 'vitest'
import { installForkContractInboxSource } from '../completion-contract/contract-inbox'
import { inboxSourceItems } from '../idle-recovery/idle-recovery-sources'
import { readReviewGate, readReviewWorkerTold, listReviewRuns } from './reviewer-store'
import {
  removeRigFolders,
  rig
} from '../completion-contract/remote-owned-contract-rig.test-fixture'

afterEach(removeRigFolders)

const SANDBOX_FAILS =
  "echo 'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted'; echo 'VERDICT: FINDINGS 0'"

/** A Task reviewed on the server, whose reviewer cannot run there, escalated after its retry. */
async function escalatedOnServer() {
  const r = rig({ git: true, peerRun: true })
  // The server's own reviewer commands, as its settings hold them.
  Object.assign(r.serverRuntime.requireStore().getSettings(), {
    forkReviewerClaudeCommand: SANDBOX_FAILS,
    forkReviewerCodexCommand: SANDBOX_FAILS
  })
  const taskId = await r.taskCreate({ forkReview: true })
  const started = await r.startOnHome({ task: taskId })
  // The launch the rig replaces ends with the agent taking its brief.
  r.serverDb.markWorkerDispatchReady(started.dispatchId)
  expect(await r.workerDone(started.dispatchId)).toMatchObject({
    kind: 'answer',
    receipt: { lifecycle: { code: 'review_pending' } }
  })
  await expect.poll(() => readReviewWorkerTold(r.serverDb, taskId)).not.toBeNull()
  expect(listReviewRuns(r.serverDb, taskId).map((run) => run.status)).toEqual(['error', 'error'])
  expect(readReviewGate(r.serverDb, taskId)?.escalated).toBe(true)
  return { r, taskId, dispatchId: started.dispatchId }
}

async function reviewRows(taskId: string) {
  return (await inboxSourceItems()).filter((item) => item.chatId === `contract-review:${taskId}`)
}

/** The server's stop of the worker, as `worker-stop` runs it once the process is gone. */
function stopWorker(r: Awaited<ReturnType<typeof escalatedOnServer>>['r'], dispatchId: string) {
  r.serverDb.beginWorkerStop(dispatchId, 'epoch-test')
  r.serverDb.settleWorkerStop(dispatchId)
}

describe('a reviewer that could not run, on a server that owns its workers (BAD-820)', () => {
  it('gives an idle worker the wait message in its mailbox and the row says so', async () => {
    const { r, taskId, dispatchId } = await escalatedOnServer()

    // The worker has no chat and no pane the gate can type into: the letter is filed as mail.
    expect(readReviewWorkerTold(r.serverDb, taskId)).toBe('mailed')
    const mail = r.serverDb.db
      .prepare('SELECT subject, body FROM messages WHERE to_handle = ?')
      .all(`dispatch:${dispatchId}`) as { subject: string; body: string }[]
    expect(mail).toHaveLength(1)
    expect(mail[0]!.subject).toBe(`Review gate: Task ${taskId}`)
    expect(mail[0]!.body).toContain('Wait for the coordinator to settle the Task')

    installForkContractInboxSource(r.serverDb)
    const [row] = await reviewRows(taskId)
    expect(row?.reason).toContain('reviewer could not run')
    expect(row?.reason).toContain('telling it to wait is in its orchestration mailbox')
    expect(row?.reason).not.toContain('was told to wait')
  })

  it('clears the row when the worker is stopped, and it stays gone after the accept', async () => {
    const { r, taskId, dispatchId } = await escalatedOnServer()
    installForkContractInboxSource(r.serverDb)
    expect(await reviewRows(taskId)).toHaveLength(1)

    stopWorker(r, dispatchId)

    expect(r.serverDb.getTask(taskId)?.status).not.toBe('completed')
    expect(await reviewRows(taskId)).toEqual([])
    expect(readReviewGate(r.serverDb, taskId)?.escalated).toBe(false)

    // The coordinator accepts it: task-update's own write (its handler adds only the caller check).
    r.serverDb.updateTaskStatus(taskId, 'completed')
    expect(r.serverDb.getTask(taskId)?.status).toBe('completed')
    expect(await reviewRows(taskId)).toEqual([])
  })

  it('sweeps a row an older build left for a settled Task when the source is installed', async () => {
    const { r, taskId, dispatchId } = await escalatedOnServer()
    // Settled before anything read the inbox, as on a host that ran an older build.
    stopWorker(r, dispatchId)
    expect(readReviewGate(r.serverDb, taskId)?.escalated).toBe(true)

    installForkContractInboxSource(r.serverDb)

    expect(readReviewGate(r.serverDb, taskId)?.escalated).toBe(false)
    expect(await reviewRows(taskId)).toEqual([])
  })
})
