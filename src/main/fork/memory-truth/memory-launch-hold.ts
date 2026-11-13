// SLRM-2136: memory truth's "Pause new agents" through the agent launch queue. With the queue on,
// a launch made while memory is over the threshold waits in the queue (its entry says why) and
// starts when memory recovers; with the queue off, pressure-state refuses it as before. Which of
// the two acts is decided once, in the shared status (`launchesHeld` vs `launchesPaused`), so one
// launch is never both refused and queued. Electron-free: the memory watch installs it.
import { FORK_AGENT_QUEUE_MEMORY_HOLD_REASON } from '../../../shared/fork/agent-queue'
import {
  notifyLaunchHoldChanged,
  setLaunchHoldReader,
  type LaunchHoldVerdict
} from '../agent-queue/launch-hold'
import { forkMemoryStatus, onForkMemoryStatus } from './pressure-state'

/** Hold new launches while memory is over, pause is on and the queue is on. */
export function forkMemoryLaunchHold(): LaunchHoldVerdict {
  return forkMemoryStatus().launchesHeld
    ? { hold: true, reason: FORK_AGENT_QUEUE_MEMORY_HOLD_REASON }
    : { hold: false }
}

/**
 * Install the reader, and tell the queue when the hold flips so waiting launches start as soon as
 * a sample shows memory recovered (the queue's own 2 s check also catches it, and catches a
 * settings change). Returns an uninstall, for tests.
 */
export function installForkMemoryLaunchHold(): () => void {
  setLaunchHoldReader(forkMemoryLaunchHold)
  let held = forkMemoryLaunchHold().hold
  const stop = onForkMemoryStatus((status) => {
    if (status.launchesHeld !== held) {
      held = status.launchesHeld
      notifyLaunchHoldChanged()
    }
  })
  return () => {
    stop()
    setLaunchHoldReader(null)
  }
}
