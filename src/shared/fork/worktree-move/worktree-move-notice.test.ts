import { describe, expect, it } from 'vitest'
import { worktreeMoveUntrackedNames } from './worktree-move-notice'

describe('worktreeMoveUntrackedNames', () => {
  it('lists names without control characters and counts the ones cut', () => {
    expect(
      worktreeMoveUntrackedNames({
        untracked: ['a.txt', 'b\u001b[0m.txt'],
        untrackedCount: 5
      })
    ).toEqual({ names: ['a.txt', 'b[0m.txt'], more: 3 })
  })

  it('reads a source that reports no untracked files as none', () => {
    expect(worktreeMoveUntrackedNames({})).toEqual({ names: [], more: 0 })
  })
})
