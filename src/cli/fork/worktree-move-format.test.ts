import { describe, expect, it } from 'vitest'
import type { WorktreeMoveRunResult } from '../../shared/fork/worktree-move/worktree-move-runner'
import { formatWorktreeMoveResult } from './worktree-move-format'

function dryRun(over: { carryPatch: boolean }): WorktreeMoveRunResult {
  return {
    kind: 'dry-run',
    plan: {
      kind: 'move',
      steps: ['export', 'create'],
      branch: 'feature',
      remote: 'origin',
      stopTurns: false,
      carryPatch: over.carryPatch,
      leftUncommitted: false,
      push: false,
      chats: [
        {
          sessionId: 's',
          agent: 'claude',
          providerSessionId: 'p',
          name: 'Chat\u001b[31m',
          busy: false,
          transcriptBytes: 1
        }
      ],
      skippedChats: [],
      warnings: []
    },
    source: {
      path: '/src/repo',
      untracked: ['new.txt', 'evil\u001b]0;x\u0007.txt'],
      untrackedCount: 4
    } as never,
    targetRepo: { repo: 'id:r' }
  }
}

describe('formatWorktreeMoveResult dry run', () => {
  it('says transcripts and untracked files are copied, and lists the untracked names', () => {
    const text = formatWorktreeMoveResult(dryRun({ carryPatch: true }))
    expect(text).toContain('Full chat transcripts')
    expect(text).toContain('Untracked files that are not ignored are copied')
    expect(text).toContain('  untracked: new.txt')
    expect(text).toContain('...and 2 more untracked file(s)')
    // eslint-disable-next-line no-control-regex -- checking that none are left
    expect(text).not.toMatch(/[\u0000-\u0008\u001b]/)
  })

  it('says only the transcripts are copied when the patch is not carried', () => {
    const text = formatWorktreeMoveResult(dryRun({ carryPatch: false }))
    expect(text).toContain('Full chat transcripts')
    expect(text).not.toContain('Untracked')
  })
})
