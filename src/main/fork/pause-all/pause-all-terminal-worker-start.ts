// Pause all over terminal worker starts (BAD-799, FORK.md "Pause all"). A chat worker's launch waits
// in the agent queue, whose entries are chats held at their provider start; a terminal agent has no
// such start to hold, so a worker-start that would launch one is refused, with the reason and how to
// resume, before any Task or Dispatch is written. A paired server's start is refused by that
// server's own switch, since its worker-start runs there.
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { forkPauseAllRefusal, isForkPauseAllEngaged } from './pause-all-state'

export const PAUSE_ALL_WORKER_START_CODE = 'paused_by_pause_all'

/** Throws while paused when this start would launch a terminal agent; `--terminal` reuses a running one. */
export function assertForkPauseAllAllowsTerminalWorkerStart(start: {
  mode: { mode: string }
  terminal?: string
}): void {
  if (start.mode.mode !== 'terminal' || start.terminal) {
    return
  }
  forkRefuseTerminalWorkerWhilePaused(false)
}

/** The refusal; also asked at the terminal agent's own launch, for a start that fell back to a
 *  terminal after its Dispatch was written (that Dispatch then fails with this reason). */
export function forkRefuseTerminalWorkerWhilePaused(effectsApplied = true): void {
  if (isForkPauseAllEngaged()) {
    throw new OrchestrationError(
      PAUSE_ALL_WORKER_START_CODE,
      `${forkPauseAllRefusal()} A terminal worker cannot wait in the launch queue, so this start was refused; start it again after \`orca resume-all\`.${effectsApplied ? '' : ' No effects were applied.'}`,
      { effectsApplied }
    )
  }
}
