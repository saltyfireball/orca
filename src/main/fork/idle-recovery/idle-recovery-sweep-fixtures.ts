// Idle recovery (FORK.md), item D: shared test fixtures. No agent, model, network or timer.
import type { IdleRecoveryVerdict } from '../../../shared/fork/idle-recovery'
import {
  readIdleRecoverySettings,
  type IdleRecoverySettings,
  type IdleRecoverySettingsSource
} from '../../../shared/fork/idle-recovery-settings'
import type { IdleRecoverySweepDeps } from './idle-recovery-sweep'
import type { IdleRecoveryCandidate, IdleRecoveryEnding } from './idle-recovery-types'

export function testSettings(source: IdleRecoverySettingsSource = {}): IdleRecoverySettings {
  return readIdleRecoverySettings({ forkIdleSweepMode: 'wake', ...source })
}

export function testCandidate(
  overrides: Partial<IdleRecoveryCandidate> = {}
): IdleRecoveryCandidate {
  return {
    chatId: 'chat-1',
    kind: 'chat',
    agent: 'claude',
    cwd: '/work',
    title: 'A chat',
    workspace: 'main',
    worktreeId: null,
    role: 'standalone',
    requestSource: 'user',
    lastPrompt: 'do the thing',
    idleSince: 1_000,
    backgroundPending: false,
    scheduledWake: false,
    coordinatorBusy: false,
    ...overrides
  }
}

export function testVerdict(overrides: Partial<IdleRecoveryVerdict> = {}): IdleRecoveryVerdict {
  return {
    verdict: 'finished',
    reason: 'r',
    question: '',
    nextStep: '',
    wakeAfterSeconds: 0,
    ...overrides
  }
}

/** A fake world for the sweep: its candidates, endings and verdicts are set by the test. */
export function fakeSweepWorld() {
  const world = {
    candidates: [] as IdleRecoveryCandidate[],
    endings: new Map<string, IdleRecoveryEnding | null>(),
    verdict: testVerdict() as IdleRecoveryVerdict | ((chatId: string) => IdleRecoveryVerdict),
    wakeTaken: true,
    reads: [] as string[],
    classified: [] as string[],
    wakes: [] as { chatId: string; nextStep: string }[],
    /** Highest number of classifier calls in flight at once. */
    peak: 0,
    deps: {} as IdleRecoverySweepDeps
  }
  let inFlight = 0
  world.deps = {
    listCandidates: async () => world.candidates,
    readEnding: async (candidate) => {
      world.reads.push(candidate.chatId)
      return world.endings.has(candidate.chatId)
        ? (world.endings.get(candidate.chatId) ?? null)
        : { lastUserRequest: 'do the thing', lastAssistantMessage: 'ending' }
    },
    classify: async (input) => {
      world.classified.push(input.chat.id)
      inFlight += 1
      world.peak = Math.max(world.peak, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return typeof world.verdict === 'function' ? world.verdict(input.chat.id) : world.verdict
    },
    sendWake: async (candidate, nextStep) => {
      world.wakes.push({ chatId: candidate.chatId, nextStep })
      return world.wakeTaken
    },
    concurrency: 3
  }
  return world
}
