// Decision inbox (FORK.md "Idle recovery"): the pure rules of the dialog and the toolbar count.
import type {
  ForkIdleRecoveryInboxItem,
  ForkIdleRecoveryInboxResult
} from '../../../../shared/fork/idle-recovery-wire'

export type DecisionInboxSections = {
  /** Chats waiting on the user, oldest first. */
  waiting: ForkIdleRecoveryInboxItem[]
  /** Chats that stopped on work they could do now, oldest first. */
  stalled: ForkIdleRecoveryInboxItem[]
}

function oldestFirst(items: readonly ForkIdleRecoveryInboxItem[]): ForkIdleRecoveryInboxItem[] {
  return [...items].sort((a, b) => a.since - b.since)
}

export function decisionInboxSections(
  items: readonly ForkIdleRecoveryInboxItem[] | null | undefined
): DecisionInboxSections {
  const list = items ?? []
  return {
    waiting: oldestFirst(list.filter((item) => item.verdict === 'waiting_user')),
    stalled: oldestFirst(list.filter((item) => item.verdict === 'stalled'))
  }
}

/** The chat that has waited on the user longest, or null when none waits. */
export function oldestWaitingChat(
  items: readonly ForkIdleRecoveryInboxItem[] | null | undefined
): ForkIdleRecoveryInboxItem | null {
  return decisionInboxSections(items).waiting[0] ?? null
}

/** What a count badge shows: the number, capped so the toolbar keeps its width. */
export function decisionInboxBadgeText(count: number): string {
  return count > 99 ? '99+' : String(count)
}

/**
 * The host's clock now: its clock at the last read plus the time since, so ages keep moving
 * between change events without reading the inbox again.
 */
export function decisionInboxNow(
  result: Pick<ForkIdleRecoveryInboxResult, 'now'>,
  receivedAt: number,
  localNow: number
): number {
  return result.now + Math.max(0, localNow - receivedAt)
}
