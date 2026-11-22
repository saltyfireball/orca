// Goal loop (BAD-682, FORK.md): what one turn end of an agent with a goal does. The check, the
// judge, the ledger and the send are passed in, so the stop conditions are tested with fakes.
// The check command and the judge criteria are the ones `orca goal set` stored: nothing the agent
// wrote is ever run. The agent's words reach the judge only inside a fenced untrusted block.
import {
  decideGoalStep,
  failureSignature,
  goalContinueText,
  GOAL_LOOP_MAX_SEND_FAILURES,
  type GoalJudgeVerdict,
  type GoalLoopSettings,
  type GoalRecord,
  type GoalStopReason
} from '../../../shared/fork/goal-loop'

export type GoalCheckRun = { ok: boolean; output: string }

export type GoalEngineDeps = {
  now: () => number
  settings: () => GoalLoopSettings
  /** Runs the goal's check command in the agent's workspace. Never throws. */
  runCheck: (command: string, settings: GoalLoopSettings) => Promise<GoalCheckRun>
  /** Asks the judge command. Never throws; a failed judge is a verdict of not met. */
  judge: (
    command: string,
    criteria: string,
    agentOutput: string,
    settings: GoalLoopSettings
  ) => Promise<GoalJudgeVerdict>
  /**
   * A fingerprint of the agent's workspace (its uncommitted changes). A failure that comes back
   * with the workspace changed is progress, not a stall.
   */
  fingerprint: () => Promise<string>
  /** The agent's last message, or null when it cannot be read. */
  readAgentOutput: () => Promise<string | null>
  /** Estimated USD the ledger holds for the agent, or null when it has none. */
  spentTotalUsd: () => number | null
  /** True when the agent took the message. */
  send: (text: string) => Promise<boolean>
}

export type GoalStepResult =
  | { kind: 'sent' }
  | { kind: 'retry' }
  | { kind: 'stopped'; reason: GoalStopReason; text: string }

function stop(goal: GoalRecord, reason: GoalStopReason, text: string, now: number): GoalStepResult {
  goal.status = 'stopped'
  goal.stop = { reason, text, at: now }
  return { kind: 'stopped', reason, text }
}

/** Runs the goal's check once for an agent whose turn ended, and acts on the decision. */
export async function runGoalStep(goal: GoalRecord, deps: GoalEngineDeps): Promise<GoalStepResult> {
  const settings = deps.settings()
  const now = deps.now()
  const spent = deps.spentTotalUsd()
  let passed: boolean | null = null
  let output = ''
  let signature: string | null = null
  const overBudget =
    goal.budgetUsd > 0 && Math.max(0, (spent ?? 0) - goal.baselineUsd) >= goal.budgetUsd
  if (goal.until.kind === 'cmd') {
    // A command costs nothing, so it runs even past the budget: a pass is still a pass.
    const run = await deps.runCheck(goal.until.command, settings)
    passed = run.ok
    output = run.output
  } else if (!overBudget) {
    if (!settings.judgeCommand) {
      return stop(goal, 'unreachable', 'No judge command is set (forkGoalJudgeCommand).', now)
    }
    const agentOutput = await deps.readAgentOutput()
    const verdict = await deps.judge(
      settings.judgeCommand,
      goal.until.criteria,
      agentOutput ?? '',
      settings
    )
    passed = verdict.met
    output = verdict.reason
  }
  if (passed === false) {
    signature = `${failureSignature(goal.until.kind, output)}|${await deps.fingerprint()}`
  }
  const decision = decideGoalStep({
    goal,
    passed,
    signature,
    spentUsd: spent,
    settings
  })
  if (decision.action === 'met') {
    return stop(goal, 'met', 'The goal was met.', now)
  }
  goal.lastFailure = output.slice(-4000)
  if (decision.action === 'stop') {
    return stop(goal, decision.reason, decision.text, now)
  }
  const limit = goal.maxRounds > 0 ? goal.maxRounds : settings.maxRounds
  const taken = await deps.send(goalContinueText({ goal, limit, output }))
  if (!taken) {
    goal.sendFailures += 1
    if (goal.sendFailures >= GOAL_LOOP_MAX_SEND_FAILURES) {
      return stop(goal, 'unreachable', 'The agent could not be reached to continue.', now)
    }
    return { kind: 'retry' }
  }
  goal.sendFailures = 0
  goal.rounds += 1
  goal.lastSignature = signature
  goal.repeats = decision.repeats
  return { kind: 'sent' }
}
