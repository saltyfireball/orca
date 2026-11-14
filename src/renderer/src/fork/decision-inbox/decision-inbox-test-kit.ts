// Decision inbox tests: a fake `window.api.forkIdleRecovery` and inbox items. Nothing here
// reaches a main process.
import { vi } from 'vitest'
import type {
  ForkIdleRecoveryAnswerOutcome,
  ForkIdleRecoveryApi,
  ForkIdleRecoveryInboxItem,
  ForkIdleRecoveryInboxResult
} from '../../../../shared/fork/idle-recovery-wire'

export const NOW = Date.parse('2026-01-15T12:00:00.000Z')
const MINUTE = 60_000

export function inboxItem(
  overrides: Partial<ForkIdleRecoveryInboxItem>
): ForkIdleRecoveryInboxItem {
  return {
    chatId: 'session-1',
    kind: 'chat',
    agent: 'claude',
    title: 'Fix the importer',
    workspace: 'importer',
    worktreeId: 'wt1',
    verdict: 'waiting_user',
    question: 'Should I keep the old column?',
    reason: 'ended on a question',
    since: NOW - 5 * MINUTE,
    wakes: 0,
    wakeAt: null,
    paused: false,
    ...overrides
  }
}

export type FakeBridge = ForkIdleRecoveryApi & {
  inbox: ReturnType<typeof vi.fn<ForkIdleRecoveryApi['inbox']>>
  answer: ReturnType<typeof vi.fn<ForkIdleRecoveryApi['answer']>>
  pause: ReturnType<typeof vi.fn<ForkIdleRecoveryApi['pause']>>
  /** The inbox the next read returns. */
  setItems: (items: ForkIdleRecoveryInboxItem[]) => void
  setAnswerOutcome: (outcome: ForkIdleRecoveryAnswerOutcome) => void
  /** Fire the main process's change event. */
  emitChanged: () => void
  /** Change listeners attached right now. */
  listenerCount: () => number
}

export function installFakeBridge(initial: ForkIdleRecoveryInboxItem[] = []): FakeBridge {
  let items = initial
  let outcome: ForkIdleRecoveryAnswerOutcome = 'sent'
  const listeners = new Set<() => void>()
  const bridge: FakeBridge = {
    inbox: vi.fn(async (): Promise<ForkIdleRecoveryInboxResult> => ({
      now: NOW,
      mode: 'inbox',
      items
    })),
    answer: vi.fn(async ({ chatId }) => ({ chatId, result: outcome })),
    pause: vi.fn(async ({ chatId, paused }) => ({ chatId, paused, pausedCount: 1, saved: true })),
    status: vi.fn(async () => ({
      mode: 'inbox' as const,
      running: true,
      classifier: 'builtin' as const,
      lastSweepAt: null,
      waiting: 0,
      stalled: 0,
      paused: []
    })),
    onChanged: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setItems: (next) => {
      items = next
    },
    setAnswerOutcome: (next) => {
      outcome = next
    },
    emitChanged: () => {
      for (const listener of listeners) {
        listener()
      }
    },
    listenerCount: () => listeners.size
  }
  Object.assign(window, { api: { forkIdleRecovery: bridge } })
  return bridge
}
