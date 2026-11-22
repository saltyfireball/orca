// Fork (BAD-689, FORK.md "Automation run triggers"): hands a finished run's chained starts to the
// event path, and records the ones the depth limit stops.
import {
  CHAIN_ENABLED_SETTING,
  CHAIN_MAX_DEPTH_SETTING
} from '../../shared/automation-chain-triggers'
import type { AutomationRun } from '../../shared/automations/history/automation-run'
import type { GlobalSettings } from '../../shared/settings/global-settings-types'
import { chainStartsFor, type ChainStart } from './automation-chain-runs'
import {
  eventRun,
  runForEvent,
  takingAutomation,
  type AutomationTriggerRunContext
} from './automation-trigger-runs'

// The stopped start stays in the target's run history, skipped, with the reason.
async function recordChainRefusal(
  deps: AutomationTriggerRunContext,
  start: ChainStart
): Promise<void> {
  const { automationId, event } = start
  await deps.inLane(automationId, async () => {
    const automation = takingAutomation(deps.store, automationId, event)
    if (!automation || eventRun(deps.store, automationId, event)) {
      return
    }
    const refused = await deps.runs.createRun(automation, event.occurredAt, 'event', event)
    await deps.runs.updateRun({
      runId: refused.id,
      status: 'skipped_unavailable',
      workspaceId: automation.workspaceId,
      error: start.refusal ?? null
    })
  })
}

/** Never throws: a chained start that fails is logged, and the finished run is unaffected. */
export async function startChainedRuns(
  deps: AutomationTriggerRunContext,
  globalSettings: Readonly<GlobalSettings>,
  run: AutomationRun
): Promise<void> {
  try {
    const settings: Record<string, unknown> = { ...globalSettings }
    const maxDepth = settings[CHAIN_MAX_DEPTH_SETTING]
    const starts = chainStartsFor({
      run,
      automations: deps.store.listAutomations(),
      settings: {
        enabled: settings[CHAIN_ENABLED_SETTING] !== false,
        maxDepth: typeof maxDepth === 'number' ? maxDepth : undefined
      },
      now: Date.now()
    })
    for (const start of starts) {
      await (start.refusal
        ? recordChainRefusal(deps, start)
        : runForEvent(deps, start.automationId, start.event))
    }
  } catch (error) {
    console.warn('[automations] chained runs failed to start:', error)
  }
}
