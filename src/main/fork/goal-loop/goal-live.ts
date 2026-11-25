// Goal loop (BAD-682, FORK.md "Goal loop"): the service wired to this process: the live readers
// (agents, ledger, check runner, judge, send), the timer and the Decision inbox source.
// `goalLoopService` is created on first use because the RPC may arrive before start-up.
// Keep electron out of this file.
import { createHash } from 'node:crypto'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import {
  goalStopTitle,
  readGoalLoopSettings,
  type ForkGoalLoopSettings,
  type GoalLoopSettings
} from '../../../shared/fork/goal-loop'
import { readIdleRecoverySettings } from '../../../shared/fork/idle-recovery-settings'
import { agentGuardSpendOf } from '../agent-guards/agent-guards-scopes'
import { readAgentGuardRows } from '../agent-guards/agent-guards-host'
import { localCheckRunner, runDoneCheck } from '../completion-contract/check-runner'
import { startForkBackoffTimer } from '../fork-backoff-timer'
import { readIdleRecoveryEndingWith } from '../idle-recovery/idle-recovery-ending'
import { liveIdleRecoveryHost, setIdleRecoveryRuntime } from '../idle-recovery/idle-recovery-host'
import { listIdleRecoveryCandidatesWith } from '../idle-recovery/idle-recovery-candidates'
import { setIdleRecoveryTerminalRuntime } from '../idle-recovery/idle-recovery-ports'
import {
  notifyForkInboxSourceChanged,
  registerForkInboxSource
} from '../idle-recovery/idle-recovery-sources'
import {
  createGoalService,
  GOAL_LOOP_IDLE_SWEEP_MS,
  GOAL_LOOP_SWEEP_MS,
  type GoalLoopRuntime,
  type GoalService,
  type GoalServiceDeps
} from './goal-service'
import { runGoalJudge } from './goal-judge'
import { sendGoalText } from './goal-send'
import { setForkGoalBudgetWatch } from './goal-budget-watch'
import { goalLoopPath, readGoals, writeGoals } from './goal-store'
import { setForkGoalCloseListener } from './goal-close-notes'
import { goalWorkerFinished } from './goal-worker-finished'

const FINGERPRINT_COMMAND =
  'git status --porcelain=v1 -uall 2>/dev/null; git diff HEAD 2>/dev/null; git rev-parse HEAD 2>/dev/null || ls -lAR 2>/dev/null'

/** What the agent changed: its uncommitted work, its head commit, else a folder listing. */
async function workspaceFingerprint(cwd: string): Promise<string> {
  const raw = await localCheckRunner({ cwd, connectionId: null }, FINGERPRINT_COMMAND, 30_000)
  return createHash('sha1').update(raw.output).digest('hex').slice(0, 12)
}

let service: GoalService | null = null
let stopTimer: (() => void) | null = null
let liveRuntime: GoalLoopRuntime | null = null

function liveSettings(): GoalLoopSettings {
  const store = liveRuntime?.requireStore()
  return readGoalLoopSettings(store?.getSettings() as ForkGoalLoopSettings | undefined)
}

function liveDeps(runtime: GoalLoopRuntime): GoalServiceDeps {
  let path: string | null = null
  const statePath = async (): Promise<string> => {
    if (!path) {
      const { getProfileUserDataPath } = await import('../../orca-profiles/profile-storage-paths')
      path = goalLoopPath(getProfileUserDataPath())
    }
    return path
  }
  return {
    now: Date.now,
    settings: liveSettings,
    loadGoals: async () => readGoals(await statePath()),
    saveGoals: async (goals) => writeGoals(await statePath(), goals),
    candidates: async (idleSeconds) => {
      setIdleRecoveryRuntime(runtime)
      const base = readIdleRecoverySettings(
        runtime.requireStore().getSettings() as ForkGlobalSettings
      )
      return listIdleRecoveryCandidatesWith(
        liveIdleRecoveryHost(),
        // Idle recovery's own mode and pauses do not apply: this loop reads only its goals.
        { ...base, mode: 'inbox', idleSeconds, workers: 'include', paused: [] },
        Date.now()
      )
    },
    liveAgents: async () => {
      const rows = await readAgentGuardRows(runtime)
      return [
        ...rows.chats.map((chat) => ({
          id: chat.sessionId,
          kind: 'chat' as const,
          agent: chat.agent,
          title: chat.title,
          worktreeId: chat.worktreeId
        })),
        ...[...rows.terminals].map(([paneKey, title]) => ({
          id: paneKey,
          kind: 'terminal' as const,
          agent: '',
          title,
          worktreeId: null
        }))
      ]
    },
    // Desktop and `orca serve` finish it once restored terminals are placed; orcad starts this loop after.
    restored: () => !runtime.startupWorkerAuthority.isPending(),
    workerFinished: (id) => goalWorkerFinished(runtime.getExistingOrchestrationDb(), id),
    fingerprint: workspaceFingerprint,
    agentOutput: async (candidate) =>
      (await readIdleRecoveryEndingWith(liveIdleRecoveryHost(), candidate))?.lastAssistantMessage ??
      null,
    spentTotalUsd: (id) => agentGuardSpendOf(id).totalUsd,
    send: (candidate, text) => sendGoalText(candidate, text),
    runCheck: async (cwd, command, settings) => {
      const target = { cwd, connectionId: null }
      const result = await runDoneCheck(localCheckRunner, target, command, {
        timeoutMs: settings.timeoutMs,
        outputLines: settings.outputLines
      })
      return {
        ok: result.ok,
        output: result.timedOut
          ? `The check timed out.\n${result.output}`
          : result.exitCode === null && !result.output
            ? 'The check could not be run.'
            : result.output
      }
    },
    judge: (command, criteria, agentOutput, settings) =>
      runGoalJudge(command, criteria, agentOutput, settings),
    notifyStopped: (goal) => {
      void import('../idle-recovery/idle-recovery-notify').then(({ sendForkNotifyTargets }) => {
        const targets = readIdleRecoverySettings(
          liveRuntime?.requireStore().getSettings() as ForkGlobalSettings
        )
        const title = `${goalStopTitle(goal.stop?.reason ?? 'met')}: ${goal.title || goal.agent}`
        void sendForkNotifyTargets({
          logTag: 'goal-loop',
          desktop: targets.notifyDesktop
            ? { title: title.slice(0, 200), body: goal.stop?.text ?? '' }
            : null,
          webhookUrl: targets.notifyWebhookUrl,
          command: targets.notifyCommand,
          payload: () =>
            JSON.stringify({
              event: 'goal-loop-stopped',
              id: goal.id,
              reason: goal.stop?.reason,
              text: goal.stop?.text,
              rounds: goal.rounds
            })
        })
      })
    },
    changed: notifyForkInboxSourceChanged
  }
}

/** The service for this process; created on first use (the RPC may arrive before start-up). */
export function goalLoopService(runtime?: GoalLoopRuntime): GoalService {
  if (runtime) {
    liveRuntime = runtime
  }
  if (!service) {
    if (!liveRuntime) {
      throw new Error('The goal loop is not running on this host yet.')
    }
    service = createGoalService(liveDeps(liveRuntime))
  }
  return service
}

function arm(): void {
  stopTimer?.()
  stopTimer = startForkBackoffTimer({
    run: () => goalLoopService().sweep(),
    baseMs: GOAL_LOOP_SWEEP_MS,
    maxMs: GOAL_LOOP_IDLE_SWEEP_MS,
    onError: (error) => console.warn('[fork goal loop] sweep failed', error)
  })
}

/** Starts the loop's timer once the runtime settles. With no goal set it reads nothing. */
export function startForkGoalLoop(runtime: GoalLoopRuntime): void {
  const live = goalLoopService(runtime)
  setForkGoalBudgetWatch(() => live.watchesSpend())
  void live.warm().catch((error: unknown) => console.warn('[fork goal loop] could not load', error))
  setForkGoalCloseListener((ids) => {
    void live.noteClosed(ids).catch((error: unknown) => {
      console.warn('[fork goal loop] could not note a close', error)
    })
  })
  setIdleRecoveryTerminalRuntime(() => liveRuntime)
  registerForkInboxSource({
    id: 'goal',
    items: () => live.inboxItems(),
    answer: async () => null,
    dismiss: (chatId) => live.dismiss(chatId)
  })
  arm()
}

/** A goal was set: the next sweep comes soon instead of after the backed-off wait. */
export function rearmForkGoalLoop(): void {
  if (stopTimer) {
    arm()
  }
}
