import { describe, expect, it, vi } from 'vitest'

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('@/store/github/refresh/worktree-refresh', () => ({ findWorktreeById: () => null }))

const { forkApprovalOptionHeld, forkGradeApproval, forkSessionSends } =
  await import('./fork-approval-triage')
const { forkLowRiskWorkerApprovals } = await import('./ForkApprovalBulkAllow')

const CWD = '/w/app'

function entry(id: string, command: string, extra: Record<string, unknown> = {}) {
  return {
    approval: {
      v: 1 as const,
      approvalId: id,
      state: 'open' as const,
      worker: { handle: 'h', dispatchId: 'd', taskId: 't' },
      summary: { title: 'Allow Bash?', detail: JSON.stringify({ command }), reason: null },
      allowedActions: ['allow' as const, 'deny' as const],
      ...extra
    },
    at: '2026-11-18T00:00:00Z',
    worker: { partyKey: 'p', role: 'worker' as const, label: 'w', agentKind: 'claude', status: 'x' }
  }
}

describe('approval triage', () => {
  it('bulk allow takes only open, allowable, low risk prompts', () => {
    const entries = [
      entry('a', 'git status'),
      entry('b', 'git push'),
      entry('c', 'curl https://x'),
      entry('d', 'ls', { state: 'answered' }),
      entry('e', 'ls', { allowedActions: ['deny'] }),
      entry('f', 'cat src/a.ts')
    ]
    const low = forkLowRiskWorkerApprovals(entries, () => CWD)
    expect(low.map((e) => e.approval.approvalId)).toEqual(['a', 'f'])
  })

  it('bulk allow takes nothing when the worker folder is unknown and paths are absolute', () => {
    const entries = [entry('a', `cat ${CWD}/a.ts`)]
    expect(forkLowRiskWorkerApprovals(entries, () => null)).toEqual([])
  })

  it('holds the session option only on a high risk card', () => {
    const triage = { cwd: CWD, sessionSends: ['allowForSession'] }
    expect(forkApprovalOptionHeld({ risk: 'high', reason: '' }, triage, 'allowForSession')).toBe(
      true
    )
    expect(forkApprovalOptionHeld({ risk: 'high', reason: '' }, triage, 'allow')).toBe(false)
    expect(forkApprovalOptionHeld({ risk: 'medium', reason: '' }, triage, 'allowForSession')).toBe(
      false
    )
    expect(forkApprovalOptionHeld(null, triage, 'allowForSession')).toBe(false)
  })

  it('reads the session options from their intent', () => {
    expect(
      forkSessionSends({
        kind: 'approval',
        title: 'Allow Bash?',
        detail: null,
        options: [
          { id: 'allow', label: 'Allow', intent: 'allow_once' },
          { id: 'allowForSession', label: 'Allow for this session', intent: 'allow_always' },
          { id: 'deny', label: 'Deny', intent: 'reject_once' }
        ],
        resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
      })
    ).toEqual(['allowForSession'])
  })

  it('does not grade a plan, a sign-in page or a startup dialog', () => {
    expect(
      forkGradeApproval(
        { title: 'Review proposed plan', options: [], subject: { kind: 'plan', text: 'x' } },
        { cwd: CWD }
      )
    ).toBeNull()
    expect(
      forkGradeApproval({ title: 'Trust?', options: [], startupDialog: 'x' }, { cwd: CWD })
    ).toBeNull()
    expect(
      forkGradeApproval(
        { title: 'Allow Bash?', options: [], detail: '{"command":"ls"}' },
        { cwd: CWD }
      )?.risk
    ).toBe('low')
  })
})
