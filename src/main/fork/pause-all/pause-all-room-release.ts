// Pause all over bot room hand-offs (BAD-818, FORK.md "Pause all"): releasing the switch lets each
// hand-off it held go on once, oldest first, as it would have (the hop limit still counts it). A
// hold is claimed before its wake and settled after, so a second release, or a restart in between,
// never wakes anyone twice; a switch released while the app was down releases them at start.
import { runKeyedSerializedOperation } from '../../../shared/concurrency/keyed-serialized-operations'
import { handOffGroupMentions } from '../../bots/bot-group-mention-handoffs'
import type { BotGroupRuntime } from '../../bots/bot-group-runtime'
import {
  pauseAllRoomHolds,
  settlePauseAllRoomHold,
  type PauseAllRoomHold
} from './pause-all-room-hold-store'
import { isForkPauseAllEngaged, onForkPauseAllChanged } from './pause-all-state'

function heldTurn(groups: BotGroupRuntime, hold: PauseAllRoomHold) {
  const message = groups.store.message(hold.messageId)
  const turn = message?.turns.find((candidate) => candidate.operationId === hold.operationId)
  return message && turn ? { message, turn } : null
}

/** Whether the hold's turn woke anyone: its hand-off lines commit with the turn's marker. */
function wokeAny(groups: BotGroupRuntime, hold: PauseAllRoomHold): boolean {
  return (heldTurn(groups, hold)?.turn.handedOff ?? []).some((botId) =>
    groups.store.message(`handoff:${hold.operationId}:${botId}`)
  )
}

/** Clears the turn's handed-off marker so its hand-off runs (`to` undefined), or puts an empty
 *  one back where none is, so a replayed end wakes nobody. */
function markTurn(groups: BotGroupRuntime, hold: PauseAllRoomHold, to?: string[]): void {
  const message = groups.store.message(hold.messageId)
  if (!message) {
    return
  }
  groups.store.update({
    ...message,
    turns: message.turns.map(({ handedOff, ...turn }) =>
      turn.operationId !== hold.operationId
        ? { ...turn, handedOff }
        : to === undefined
          ? turn
          : { ...turn, handedOff: handedOff ?? to }
    )
  })
}

/** Ends a release: done when the wake ran (or was stored before a restart), else held again. */
function settleReleasing(groups: BotGroupRuntime, hold: PauseAllRoomHold, done: boolean): void {
  const { store } = groups
  if (done) {
    settlePauseAllRoomHold(store.db, hold.operationId, 'released', 'releasing')
    return
  }
  store.transaction(() => {
    markTurn(groups, hold, [])
    settlePauseAllRoomHold(store.db, hold.operationId, 'held', 'releasing')
  })
}

const releases = new WeakMap<BotGroupRuntime, Promise<number>>()

/** Lets each held hand-off go on once, oldest first; how many went on. Nothing while engaged. */
export function releaseForkPauseAllRoomHolds(groups: BotGroupRuntime): Promise<number> {
  let running = releases.get(groups)
  if (!running) {
    running = releaseNow(groups).finally(() => releases.delete(groups))
    releases.set(groups, running)
  }
  return running
}

async function releaseNow(groups: BotGroupRuntime): Promise<number> {
  const { db } = groups.store
  let released = 0
  for (const hold of pauseAllRoomHolds(db, 'held')) {
    // Engaged again meanwhile: the rest stay held.
    if (isForkPauseAllEngaged()) {
      break
    }
    if (!settlePauseAllRoomHold(db, hold.operationId, 'releasing', 'held')) {
      continue
    }
    if (!heldTurn(groups, hold)) {
      settlePauseAllRoomHold(db, hold.operationId, 'dropped', 'releasing')
      continue
    }
    await runKeyedSerializedOperation(groups.queues, hold.groupId, async () =>
      markTurn(groups, hold)
    )
    const found = heldTurn(groups, hold)
    const done = found
      ? await handOffGroupMentions(groups, found.message, found.turn, {
          full: hold.replyFull,
          saved: hold.replySaved
        }).then(
          () => true,
          (error: unknown) => {
            console.warn('[fork-pause-all] a held bot room hand-off failed', error)
            return false
          }
        )
      : false
    await runKeyedSerializedOperation(groups.queues, hold.groupId, async () =>
      settleReleasing(groups, hold, done)
    )
    released += done ? 1 : 0
  }
  if (released > 0) {
    console.info('[fork-pause-all] released held bot room hand-offs', { released })
  }
  return released
}

const installed = new WeakSet<BotGroupRuntime>()

/** Called as the room runtime is built: settles a release the app stopped in, and releases the
 *  holds whenever the switch is released. The start's own release runs after pending turns resume. */
export function installForkPauseAllRoomHolds(groups: BotGroupRuntime): void {
  if (installed.has(groups)) {
    return
  }
  installed.add(groups)
  try {
    for (const hold of pauseAllRoomHolds(groups.store.db, 'releasing')) {
      settleReleasing(groups, hold, wokeAny(groups, hold))
    }
  } catch (error) {
    console.warn('[fork-pause-all] could not settle held bot room hand-offs at start', error)
  }
  onForkPauseAllChanged((state) => {
    if (!state.engaged) {
      void releaseForkPauseAllRoomHolds(groups).catch((error: unknown) =>
        console.warn('[fork-pause-all] releasing held bot room hand-offs failed', error)
      )
    }
  })
}
