// Idle recovery (FORK.md): other features' rows in the Decision inbox. The PR babysitter
// (SLRM-2386) lists the pull requests it stopped on; they show with idle recovery off too, and an
// answer or Stop that names the source goes to it.
import type {
  ForkIdleRecoveryAnswerOutcome,
  ForkIdleRecoveryInboxItem,
  ForkIdleRecoveryPauseResult
} from '../../../shared/fork/idle-recovery-wire'

/**
 * Another feature's rows in the Decision inbox (the PR babysitter's, SLRM-2386). They show with
 * idle recovery off too; answer and pause reach the source when the request names it.
 */
export type ForkInboxSource = {
  id: 'babysit' | 'contract' | 'nudge' | 'goal'
  items: () => Promise<ForkIdleRecoveryInboxItem[]>
  /** Null when the source has no row for the chat. */
  answer: (chatId: string, text: string) => Promise<ForkIdleRecoveryAnswerOutcome | null>
  /** Takes the chat's row off for good; false when it had none. */
  dismiss: (chatId: string) => Promise<boolean>
}

const inboxSources = new Map<ForkInboxSource['id'], ForkInboxSource>()
const changeListeners = new Set<() => void>()

/** A source's rows changed: every window reads the inbox again (the bridge listens). */
export function notifyForkInboxSourceChanged(): void {
  for (const listener of changeListeners) {
    try {
      listener()
    } catch (error) {
      console.warn('[fork idle recovery] change listener failed', error)
    }
  }
}

export function onForkInboxSourceChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}

export async function inboxSourceItems(): Promise<ForkIdleRecoveryInboxItem[]> {
  const lists = await Promise.all(
    [...inboxSources.values()].map((source) =>
      source.items().catch((error: unknown) => {
        console.warn('[fork idle recovery] an inbox source failed', error)
        return []
      })
    )
  )
  return lists.flat()
}

/** Adds a source's rows to the inbox (idempotent per id); returns its removal. */
export function registerForkInboxSource(source: ForkInboxSource): () => void {
  inboxSources.set(source.id, source)
  return () => {
    if (inboxSources.get(source.id) === source) {
      inboxSources.delete(source.id)
    }
  }
}

/** The source's answer; 'not-found' when it has no such row. */
export async function answerFromInboxSource(
  id: ForkInboxSource['id'],
  chatId: string,
  text: string
): Promise<ForkIdleRecoveryAnswerOutcome> {
  return (await inboxSources.get(id)?.answer(chatId, text)) ?? 'not-found'
}

/** A source's row has no pause: Pause takes it off (the babysitter stops for that PR). */
export async function pauseFromInboxSource(
  request: { chatId: string; paused: boolean; source?: ForkInboxSource['id'] },
  pausedCount: number
): Promise<ForkIdleRecoveryPauseResult> {
  const source = request.source ? inboxSources.get(request.source) : undefined
  const saved = request.paused && source ? await source.dismiss(request.chatId) : false
  if (saved) {
    notifyForkInboxSourceChanged()
  }
  return { chatId: request.chatId, paused: false, pausedCount, saved }
}
