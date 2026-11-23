// Completion contract, later push (BAD-676, FORK.md): one read of a settled Task's pull request, on
// the host whose workspace ran its checks (this computer, or the paired server the Run home asks).
// A new head, or a new verdict on the same head, is kept as an attempt; nothing about the Task or
// its rounds changes.
import type { ForkLaterPushRead } from '../../../shared/fork/completion-contract-wire'
import { insertAttempt, lastPrResult, readContract, type ContractDbHandle } from './contract-store'
import type { GateWorkspace } from './completion-gate'
import { prReadResult, readPrHeadChecks } from './pr-checks'

export type LaterPushReadRequest = {
  taskId: string
  dispatchId: string | null
  worktreeId: string | null
  outputLines: number
}

const BRANCH = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/u

export async function readLaterPushHere(
  handle: ContractDbHandle,
  workspaceOf: (worktreeId: string) => Promise<GateWorkspace | null>,
  request: LaterPushReadRequest
): Promise<ForkLaterPushRead> {
  if (!readContract(handle, request.taskId)?.contract.requirePrChecks) {
    return { kind: 'gone', reason: 'the Task asks for no pull request checks here' }
  }
  let workspace: GateWorkspace | null = null
  try {
    workspace = request.worktreeId ? await workspaceOf(request.worktreeId) : null
  } catch {
    workspace = null
  }
  if (!workspace?.git) {
    return { kind: 'gone', reason: 'the workspace is gone' }
  }
  const last = lastPrResult(handle, request.taskId)
  // The number pins the pull request the Task settled on, even if the branch moved on.
  const selector = last?.prNumber ? String(last.prNumber) : workspace.branch
  if (!selector || !BRANCH.test(selector)) {
    return { kind: 'gone', reason: 'the workspace has no named branch' }
  }
  const read = await readPrHeadChecks(workspace.prPort, selector)
  if (read.kind === 'unreadable') {
    return { kind: 'unreadable', reason: read.reason.replace(/^: /u, '') || 'gh gave no answer' }
  }
  if (read.state !== 'OPEN') {
    return { kind: 'closed', prNumber: read.number, state: read.state }
  }
  const verdict = {
    head: read.head,
    prNumber: read.number,
    failed: read.failed,
    pending: read.pending
  }
  if (read.failed.length === 0 && read.pending.length > 0) {
    return { kind: 'pending', ...verdict }
  }
  const kind = read.failed.length > 0 ? 'fail' : 'pass'
  if (!(last && last.headSha === read.head && last.ok === (kind === 'pass'))) {
    insertAttempt(handle, {
      taskId: request.taskId,
      dispatchId: request.dispatchId,
      outcome: kind,
      results: [prReadResult(read, request.outputLines)]
    })
  }
  return { kind, ...verdict }
}
