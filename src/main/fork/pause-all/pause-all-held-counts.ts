// Pause all (BAD-818, FORK.md "Pause all"): what this host holds for resume-all, for
// `orca pause-status`: unread bot mail, room hand-offs, waiting worker launches and queued letters.
// Null where they cannot be read (no database or bots yet).
import type { Bot } from '../../../shared/bot-types'
import type { ForkPauseAllHeld } from '../../../shared/fork/pause-all'
import { getCanonicalUserDataPath } from '../../persistence/loading-store/user-data-path'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { PAUSED_REASON } from '../agent-queue/agent-launch-gate'
import { agentQueueGate } from '../agent-queue/agent-queue-service'
import { forkLettersStore } from '../letters/letters-store'
import { forkPauseAllHeldLaunchSessions } from './pause-all-held-notes'
import { countForkPauseAllHeldMail } from './pause-all-bot-mail'
import { countPauseAllRoomHolds } from './pause-all-room-hold-store'

type CountRuntime = {
  bots?: { list: () => readonly Bot[] }
  getOrchestrationDb?: () => OrchestrationDb
}

/** Worker launches waiting for resume-all, queued now or held across a restart. */
function pausedLaunches(): number {
  const held = new Set(forkPauseAllHeldLaunchSessions())
  for (const entry of agentQueueGate().entries()) {
    if (entry.kind === 'worker' && entry.heldReason === PAUSED_REASON) {
      held.add(entry.sessionId)
    }
  }
  return held.size
}

/** Letters queued for chats here: while paused none is typed in before resume-all. */
async function queuedLetters(): Promise<number> {
  const state = await forkLettersStore(getCanonicalUserDataPath()).read()
  return state.letters.filter((letter) => letter.state === 'queued').length
}

export async function forkPauseAllHeldCounts(
  runtime: CountRuntime
): Promise<Required<ForkPauseAllHeld> | null> {
  const { bots, getOrchestrationDb } = runtime
  if (!bots || !getOrchestrationDb) {
    return null
  }
  try {
    const db = getOrchestrationDb.call(runtime)
    return {
      mail: countForkPauseAllHeldMail({ bots, getOrchestrationDb: () => db }),
      handOffs: countPauseAllRoomHolds(db.db),
      launches: pausedLaunches(),
      letters: await queuedLetters()
    }
  } catch (error) {
    console.warn('[fork-pause-all] could not count what is held', error)
    return null
  }
}
