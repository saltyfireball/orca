// Goal loop (BAD-682, FORK.md "Goal loop"): the service. `orca goal set` stores a goal for one
// agent; on a backoff timer the sweep looks at the agents with a goal, and for each one whose turn
// has ended and that has rested `forkGoalLoopIdleSeconds` it runs the goal's check (or asks the
// judge) once per turn end, sends a continue message with the failure when it is not met, and
// stops on success, the round limit, the budget or no progress. With no goal set the sweep reads
// nothing and no agent is touched. Everything it reads of the process is passed in (`GoalServiceDeps`).
import { isForkPauseAllEngaged } from '../pause-all/pause-all-state'
import {
  goalSpentUsd,
  goalStopNote,
  goalStopTitle,
  type GoalLoopSettings,
  type GoalRecord
} from '../../../shared/fork/goal-loop'
import type {
  ForkGoalClearResult,
  ForkGoalListResult,
  ForkGoalRow,
  ForkGoalSetRequest,
  ForkGoalSetResult
} from '../../../shared/fork/goal-loop-wire'
import type { IdleRecoveryTerminalRuntime } from '../idle-recovery/idle-recovery-ports'
import type { IdleRecoveryCandidate } from '../idle-recovery/idle-recovery-types'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import {
  GOAL_LOOP_WAIT_RECHECK_MS,
  runGoalStep,
  type GoalCheckRun,
  type GoalEngineDeps
} from './goal-engine'
import { endMissingGoal } from './goal-ending'
import { pruneGoals } from './goal-store'
import { goalInboxItems } from './goal-inbox'

export const GOAL_LOOP_SWEEP_MS = 10_000
export const GOAL_LOOP_IDLE_SWEEP_MS = 2 * 60_000
/** Sweeps that do not find an agent before its goal ends. */
const MISSING_SWEEPS = 3

export type GoalLoopRuntime = IdleRecoveryTerminalRuntime &
  Pick<
    OrcaRuntimeService,
    | 'getWorktreePs'
    | 'requireStore'
    | 'getExistingOrchestrationDb'
    | 'getAgentStatusSnapshotFn'
    | 'startupWorkerAuthority'
  >

/** Everything the service reads of this process, so tests pass a fake agent. */
export type GoalServiceDeps = {
  now: () => number
  settings: () => GoalLoopSettings
  loadGoals: () => Promise<Map<string, GoalRecord>>
  saveGoals: (goals: Map<string, GoalRecord>) => Promise<void>
  /** Agents whose turn has ended and that rested `idleSeconds`. */
  candidates: (idleSeconds: number) => Promise<IdleRecoveryCandidate[]>
  /** The agents running on this host: id, kind, agent, title, worktree. */
  liveAgents: () => Promise<Pick<GoalRecord, 'id' | 'kind' | 'agent' | 'title' | 'worktreeId'>[]>
  /** False until this start's restored terminals and chats are placed: nobody is missing before then. */
  restored: () => boolean
  /** BAD-822: the agent is an orchestration worker that reported worker_done. */
  workerFinished: (id: string) => boolean
  /** A fingerprint of the workspace the agent works in; empty when it cannot be read. */
  fingerprint: (cwd: string) => Promise<string>
  agentOutput: (candidate: IdleRecoveryCandidate) => Promise<string | null>
  spentTotalUsd: (id: string) => number | null
  send: (
    candidate: Pick<IdleRecoveryCandidate, 'chatId' | 'kind' | 'agent' | 'idleSince'>,
    text: string
  ) => Promise<boolean | 'wait'>
  runCheck: (cwd: string, command: string, settings: GoalLoopSettings) => Promise<GoalCheckRun>
  judge: GoalEngineDeps['judge']
  /** Tells the notify targets of a stop. */
  notifyStopped: (goal: GoalRecord) => void
  changed: () => void
}

export type GoalService = ReturnType<typeof createGoalService>

function rowOf(goal: GoalRecord, settings: GoalLoopSettings, spent: number | null): ForkGoalRow {
  return {
    id: goal.id,
    kind: goal.kind,
    agent: goal.agent,
    title: goal.title,
    until: goal.until,
    status: goal.status,
    rounds: goal.rounds,
    maxRounds: goal.maxRounds,
    roundLimit: goal.maxRounds > 0 ? goal.maxRounds : settings.maxRounds,
    budgetUsd: goal.budgetUsd,
    spentUsd: goalSpentUsd(goal, spent),
    createdAt: goal.createdAt,
    lastFailure: goal.lastFailure,
    ...(goal.stop ? { stop: goal.stop } : {})
  }
}

export function createGoalService(deps: GoalServiceDeps) {
  let goals: Map<string, GoalRecord> | null = null
  let saving: Promise<void> = Promise.resolve()
  let running = false
  let sweepCount = 0
  /** BAD-833: when a goal that waits for its agent's state is looked at again. */
  const waitUntil = new Map<string, number>()

  const loaded = async (): Promise<Map<string, GoalRecord>> => (goals ??= await deps.loadGoals())
  const save = (): Promise<void> => {
    saving = saving
      .then(() => (goals ? deps.saveGoals(goals) : undefined))
      .catch((error: unknown) => console.warn('[fork goal loop] could not save', error))
    return saving
  }

  function match(
    live: Awaited<ReturnType<GoalServiceDeps['liveAgents']>>,
    query: string
  ): Awaited<ReturnType<GoalServiceDeps['liveAgents']>>[number] {
    const exact = live.filter((agent) => agent.id === query)
    const matches =
      exact.length > 0
        ? exact
        : query.length >= 4
          ? live.filter((agent) => agent.id.startsWith(query))
          : []
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `No running agent matches "${query}". Use a chat session id or a terminal pane key.`
          : `"${query}" matches more than one agent; use more of its id.`
      )
    }
    return matches[0]
  }

  async function sweep(): Promise<boolean> {
    const settings = deps.settings()
    const all = await loaded()
    const active = [...all.values()].filter((goal) => goal.status === 'active')
    if (!settings.enabled || active.length === 0) {
      return false
    }
    // Pause all (BAD-685, FORK.md): no goal step runs while paused; active goals wait.
    if (running || isForkPauseAllEngaged()) {
      return true
    }
    running = true
    sweepCount += 1
    try {
      const idle = new Map(
        (await deps.candidates(settings.idleSeconds)).map((entry) => [entry.chatId, entry])
      )
      let changed = false
      for (const goal of active) {
        const candidate = idle.get(goal.id)
        if (!candidate) {
          // Not at rest now: a later wait counts from its own start.
          delete goal.waitingSince
          continue
        }
        goal.missing = 0
        changed ||= goal.closedAt !== undefined
        delete goal.closedAt
        // A turn end is looked at once; a goal set on an idle agent looks at that ending.
        if (goal.handledIdleSince === candidate.idleSince || candidate.backgroundPending) {
          continue
        }
        if (deps.now() < (waitUntil.get(goal.id) ?? 0)) {
          continue
        }
        waitUntil.delete(goal.id)
        const result = await runGoalStep(goal, {
          now: deps.now,
          settings: () => settings,
          runCheck: (command, current) => deps.runCheck(candidate.cwd, command, current),
          judge: deps.judge,
          fingerprint: () => deps.fingerprint(candidate.cwd),
          readAgentOutput: () => deps.agentOutput(candidate),
          spentTotalUsd: () => deps.spentTotalUsd(goal.id),
          send: (text) => deps.send(candidate, text)
        })
        changed = true
        if (result.kind === 'wait') {
          waitUntil.set(goal.id, deps.now() + GOAL_LOOP_WAIT_RECHECK_MS)
          continue
        }
        if (result.kind === 'retry') {
          // The agent could not take the message: look at this turn end again next sweep.
          continue
        }
        goal.handledIdleSince = candidate.idleSince
        if (result.kind === 'stopped') {
          deps.notifyStopped(goal)
          if (result.reason !== 'met' && settings.postToChat) {
            // Best effort: the agent may have gone busy; the inbox row holds the reason anyway.
            await deps.send(candidate, goalStopNote(result.text)).catch(() => false)
          }
        }
      }
      // Goals whose agent is not running any more end; checked every few sweeps (BAD-822).
      const notIdle = active.filter((goal) => goal.status === 'active' && !idle.has(goal.id))
      if (notIdle.length > 0 && !deps.restored()) {
        // A restart's agents may not be back yet: the missing window starts once they are.
        notIdle.forEach((goal) => (goal.missing = 0))
      } else if (notIdle.length > 0 && sweepCount % 4 === 0) {
        const live = new Set((await deps.liveAgents()).map((agent) => agent.id))
        for (const goal of notIdle) {
          if (live.has(goal.id)) {
            goal.missing = 0
            changed ||= goal.closedAt !== undefined
            delete goal.closedAt
            continue
          }
          goal.missing += 1
          if (goal.missing >= MISSING_SWEEPS) {
            endMissingGoal(goal, deps)
            changed = true
          }
        }
      }
      pruneGoals(all, deps.now())
      if (changed) {
        await save()
        deps.changed()
      }
    } catch (error) {
      console.warn('[fork goal loop] sweep failed', error)
    } finally {
      running = false
    }
    return true
  }

  return {
    sweep,

    /** BAD-766: true while an active goal has a budget, so spend is read for it; no I/O. */
    watchesSpend: (): boolean =>
      [...(goals?.values() ?? [])].some((goal) => goal.status === 'active' && goal.budgetUsd > 0),

    /** BAD-822: a person (or the CLI) closed these agents' chats or terminals; kept on disk. */
    async noteClosed(ids: readonly string[]): Promise<void> {
      const noted = [...(await loaded()).values()].filter(
        (goal) => goal.status === 'active' && ids.includes(goal.id)
      )
      if (noted.length > 0) {
        noted.forEach((goal) => (goal.closedAt = deps.now()))
        await save()
      }
    },

    /** Loads the saved goals, so `watchesSpend` knows them from start-up. */
    async warm(): Promise<void> {
      await loaded()
    },

    async set(request: ForkGoalSetRequest): Promise<ForkGoalSetResult> {
      const settings = deps.settings()
      if (Boolean(request.untilCmd) === Boolean(request.untilJudge)) {
        throw new Error('Give exactly one of --until-cmd and --until-judge.')
      }
      if (request.untilJudge && !settings.judgeCommand) {
        throw new Error(
          'No judge is set: put a judge command in Settings > Blackfish (forkGoalJudgeCommand), or use --until-cmd.'
        )
      }
      const target = match(await deps.liveAgents(), request.id)
      const all = await loaded()
      const goal: GoalRecord = {
        id: target.id,
        kind: target.kind,
        agent: target.agent,
        title: target.title,
        worktreeId: target.worktreeId,
        until: request.untilCmd
          ? { kind: 'cmd', command: request.untilCmd }
          : { kind: 'judge', criteria: request.untilJudge ?? '' },
        maxRounds: request.maxRounds ?? 0,
        budgetUsd: Math.round((request.budgetUsd ?? 0) * 100) / 100,
        baselineUsd: deps.spentTotalUsd(target.id) ?? 0,
        createdAt: deps.now(),
        status: 'active',
        rounds: 0,
        lastSignature: null,
        repeats: 0,
        handledIdleSince: null,
        sendFailures: 0,
        missing: 0,
        lastFailure: ''
      }
      all.set(goal.id, goal)
      await save()
      deps.changed()
      return { goal: rowOf(goal, settings, deps.spentTotalUsd(goal.id)) }
    },

    async clear(query: string): Promise<ForkGoalClearResult> {
      const all = await loaded()
      const goal = [...all.values()].find(
        (entry) => entry.id === query || (query.length >= 4 && entry.id.startsWith(query))
      )
      if (!goal) {
        return { id: query, cleared: false }
      }
      all.delete(goal.id)
      await save()
      deps.changed()
      return { id: goal.id, cleared: true }
    },

    async list(): Promise<ForkGoalListResult> {
      const settings = deps.settings()
      return {
        enabled: settings.enabled,
        goals: [...(await loaded()).values()].map((goal) =>
          rowOf(goal, settings, deps.spentTotalUsd(goal.id))
        )
      }
    },

    /** Decision inbox rows: goals that stopped without being met. */
    async inboxItems() {
      return goalInboxItems([...(await loaded()).values()])
    },

    /** Takes a stopped goal's row off the inbox. */
    async dismiss(chatId: string): Promise<boolean> {
      const all = await loaded()
      const goal = all.get(chatId.replace(/^goal:/u, ''))
      if (!goal || goal.status !== 'stopped') {
        return false
      }
      all.delete(goal.id)
      await save()
      deps.changed()
      return true
    },

    describeStop: goalStopTitle
  }
}
