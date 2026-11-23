// BAD-767: Orca deletes no worktree on an SSH host (its removal route refuses with a reason), so
// a worktree there is never removed without a snapshot; this pins that refusal and its wording.
import { describe, expect, it } from 'vitest'
import { toSshExecutionHostId } from '../../../shared/execution-host/execution-host'
import { resolveWorktreeRemovalRoute } from '../../workspaces/removal/worktree-removal-execution-host-route'

describe('worktree removal on an SSH host', () => {
  it('is refused, naming that nothing on the host is touched', () => {
    expect(() => resolveWorktreeRemovalRoute(toSshExecutionHostId('build-box'))).toThrow(
      /can.t delete this workspace on its SSH host.*files on the host are left untouched/s
    )
  })
})
