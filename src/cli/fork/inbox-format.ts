// Idle recovery (FORK.md), item E1: how `orca inbox` prints what the host answers.
// Contract: pure text formatting of the `idle-recovery-wire.ts` results; --json bypasses it.
import type {
  ForkIdleRecoveryAnswerOutcome,
  ForkIdleRecoveryAnswerResult,
  ForkIdleRecoveryInboxItem,
  ForkIdleRecoveryInboxResult,
  ForkIdleRecoveryPauseResult
} from '../../shared/fork/idle-recovery-wire'
import { formatDuration } from './sleepers-handlers'

export const INBOX_OFF_MESSAGE =
  'Idle recovery is off on this host, so the inbox is empty. Turn it on with: orca settings set forkIdleSweepMode inbox (or wake, which also wakes stalled chats).'

const ANSWER: Record<ForkIdleRecoveryAnswerOutcome, string> = {
  sent: 'answer sent',
  'not-found': 'no such chat on this host',
  'not-waiting': 'not waiting on you now, so nothing was sent',
  unavailable: 'idle recovery is off or not running on this host'
}

/** Chat session ids print short, terminal pane keys in full. */
export function inboxShortId(item: Pick<ForkIdleRecoveryInboxItem, 'chatId' | 'kind'>): string {
  return item.kind === 'chat' ? item.chatId.slice(0, 8) : item.chatId
}

function kindLabel(item: ForkIdleRecoveryInboxItem): string {
  return item.verdict === 'waiting_user' ? 'waiting' : 'stalled'
}

function itemLines(item: ForkIdleRecoveryInboxItem, now: number): string[] {
  const head = [
    inboxShortId(item),
    kindLabel(item),
    formatDuration(Math.max(0, now - item.since)),
    item.title || '(untitled)',
    item.workspace ? `[${item.workspace}]` : '',
    item.paused ? '(paused)' : ''
  ]
    .filter(Boolean)
    .join('  ')
  const text = (item.question || item.reason).replace(/\s+/g, ' ').trim()
  return text ? [head, `    ${text}`] : [head]
}

export function formatInboxList(result: ForkIdleRecoveryInboxResult): string {
  if (result.mode === 'off') {
    return INBOX_OFF_MESSAGE
  }
  if (result.items.length === 0) {
    return 'No chats are waiting on you.'
  }
  const count = result.items.length
  return [
    `${count} ${count === 1 ? 'chat' : 'chats'} (ID, kind, age, title):`,
    ...result.items.flatMap((item) => itemLines(item, result.now))
  ].join('\n')
}

export function formatInboxAnswer(result: ForkIdleRecoveryAnswerResult): string {
  return `${result.chatId}: ${ANSWER[result.result] ?? result.result}`
}

export function formatInboxPause(result: ForkIdleRecoveryPauseResult): string {
  if (!result.saved) {
    return `${result.chatId}: not saved, this host cannot save settings`
  }
  return `${result.chatId}: ${result.paused ? 'paused' : 'resumed'}`
}
