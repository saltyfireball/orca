// Auto-close finished automation run chats (FORK.md, BAD-848): the sweep's last decision on each
// run's chat tab, so `orca automations runs` can say why a finished run's tab is still open. Held in
// memory and replaced by every sweep; a restart refills it on the first sweep.
import type { AutomationRun } from '../../../shared/automations/history/automation-run'
import type { ForkAutomationRunTabClose } from '../../../shared/fork/automation-run-auto-close'
import type { AutomationRunAutoCloseRow } from './automation-run-auto-close'

let decisions = new Map<string, ForkAutomationRunTabClose>()

function sameDecision(a: ForkAutomationRunTabClose | undefined, b: ForkAutomationRunTabClose) {
  return a?.outcome === b.outcome && a.keep === b.keep && a.error === b.error
}

/** Replaces the decisions with this sweep's rows; a run whose decision changed gets one log line. */
export function recordAutomationRunCloseDecisions(
  rows: readonly AutomationRunAutoCloseRow[],
  at: number
): void {
  const next = new Map<string, ForkAutomationRunTabClose>()
  for (const row of rows) {
    if (row.outcome === 'would-close') {
      continue
    }
    const before = decisions.get(row.runId)
    // A tab Orca closed reads as already closed on every later sweep: keep saying who closed it.
    if (before?.outcome === 'closed' && row.keep === 'already-closed') {
      next.set(row.runId, before)
      continue
    }
    const decision: ForkAutomationRunTabClose = {
      outcome: row.outcome,
      ...(row.keep ? { keep: row.keep } : {}),
      ...(row.error ? { error: row.error } : {}),
      at
    }
    next.set(row.runId, sameDecision(before, decision) ? before! : decision)
    if (!sameDecision(before, decision)) {
      console.info(
        `[fork automation run auto-close] run ${row.runId} chat ${row.chatSessionId}: ${row.outcome}${row.keep ? ` (${row.keep})` : ''}${row.error ? `: ${row.error}` : ''}`
      )
    }
  }
  decisions = next
}

/** Hook (automation.runs): each listed run with the sweep's last decision on its chat tab. */
export function withAutomationRunCloseDecisions<
  T extends { run?: AutomationRun | null; runs?: AutomationRun[] }
>(result: T): T {
  if (decisions.size === 0) {
    return result
  }
  const decorate = (run: AutomationRun): AutomationRun => {
    const decision = decisions.get(run.id)
    return decision ? { ...run, forkTabClose: decision } : run
  }
  return {
    ...result,
    ...(result.run ? { run: decorate(result.run) } : {}),
    ...(result.runs ? { runs: result.runs.map(decorate) } : {})
  }
}

export function resetAutomationRunCloseDecisionsForTest(): void {
  decisions = new Map()
}
