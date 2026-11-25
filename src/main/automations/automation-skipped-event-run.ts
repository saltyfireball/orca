// Fork (BAD-689, BAD-819): an event start a fork limit stopped stays in the automation's run
// history as a skipped run with the reason, so a resend of the event finds it and starts nothing.
import type { AutomationRunEvent } from '../../shared/automation-event-triggers'
import type { Automation } from '../../shared/automations/automation-definition'
import type { AutomationRun } from '../../shared/automations/history/automation-run'
import type { AutomationRunWriter } from './run-history/run-writer'

export async function recordSkippedEventRun(
  runs: Pick<AutomationRunWriter, 'createRun' | 'updateRun'>,
  automation: Automation,
  event: AutomationRunEvent,
  reason: string
): Promise<AutomationRun> {
  const refused = await runs.createRun(automation, event.occurredAt, 'event', event)
  return await runs.updateRun({
    runId: refused.id,
    status: 'skipped_unavailable',
    workspaceId: automation.workspaceId,
    error: reason
  })
}
