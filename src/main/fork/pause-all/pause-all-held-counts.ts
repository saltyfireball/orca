// Pause all (BAD-818, FORK.md "Pause all"): what this host holds for resume-all, for
// `orca pause-status`. Null where it cannot be read (no database or bots yet).
import type { Bot } from '../../../shared/bot-types'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { countForkPauseAllHeldMail } from './pause-all-bot-mail'
import { countPauseAllRoomHolds } from './pause-all-room-hold-store'

type CountRuntime = {
  bots?: { list: () => readonly Bot[] }
  getOrchestrationDb?: () => OrchestrationDb
}

export function forkPauseAllHeldCounts(
  runtime: CountRuntime
): { mail: number; handOffs: number } | null {
  const { bots, getOrchestrationDb } = runtime
  if (!bots || !getOrchestrationDb) {
    return null
  }
  try {
    const db = getOrchestrationDb.call(runtime)
    return {
      mail: countForkPauseAllHeldMail({ bots, getOrchestrationDb: () => db }),
      handOffs: countPauseAllRoomHolds(db.db)
    }
  } catch (error) {
    console.warn('[fork-pause-all] could not count what is held', error)
    return null
  }
}
