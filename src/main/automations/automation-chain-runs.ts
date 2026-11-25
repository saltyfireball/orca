// Fork (BAD-689, FORK.md "Automation run triggers"): which automations start because another
// automation's run just ended, and which of those the depth limit stops. Pure; the service hands
// each start to the same event path every trigger uses.
import {
  effectiveChainMaxDepth,
  isChainTrigger,
  type AutomationChainTrigger,
  type ChainEvent
} from '../../shared/automation-chain-triggers'
import {
  MAX_AUTOMATION_EVENT_TEXT_LENGTH,
  type AutomationRunEvent
} from '../../shared/automation-event-triggers'
import type { Automation } from '../../shared/automations/automation-definition'
import type { AutomationRun } from '../../shared/automations/history/automation-run'

// What of a finished run goes into the quoted summary, so the whole event stays under the text cap.
const MAX_OUTPUT_CHARS = 2400
const MAX_ERROR_CHARS = 800

export type ChainStart = {
  automationId: string
  event: AutomationRunEvent
  /** Set when the depth limit stops this start: the run history line saying why. */
  refusal?: string
}

export type ChainSettings = { enabled: boolean; maxDepth: number | undefined }

/** The event a finished run raises: a completed run succeeded, a dispatch failure failed; skips raise none. */
export function chainEventOf(
  run: Pick<AutomationRun, 'status' | 'handledInTurn'>
): ChainEvent | null {
  if (run.handledInTurn) {
    return null
  }
  if (run.status === 'completed') {
    return 'run_succeeded'
  }
  return run.status === 'dispatch_failed' ? 'run_failed' : null
}

/** How many automation-started runs lead to this run; 0 for one a schedule or a person started. A
 *  run an own pull request of an earlier run started carries its depth too (BAD-819). */
export function chainDepthOfRun(run: Pick<AutomationRun, 'event'>): number {
  const event = run.event
  return event?.chain?.depth ?? (event?.source === 'automation' ? 1 : 0)
}

function describeRun(automation: Pick<Automation, 'name'>, run: AutomationRun, event: ChainEvent) {
  const output = run.outputSnapshot?.content.trim()
  return [
    `Automation "${automation.name}" run ${run.runNumber ?? ''}`.trim() +
      (event === 'run_failed' ? ' failed.' : ' finished.'),
    ...(run.error ? [`Error: ${run.error.slice(0, MAX_ERROR_CHARS)}`] : []),
    ...(output ? [`Output (end of it):\n${output.slice(-MAX_OUTPUT_CHARS)}`] : [])
  ]
    .join('\n')
    .slice(0, MAX_AUTOMATION_EVENT_TEXT_LENGTH)
}

function matches(
  rule: AutomationChainTrigger,
  event: ChainEvent,
  source: Pick<Automation, 'id' | 'bot'>
): boolean {
  return (
    rule.event === event &&
    (rule.automation === undefined || rule.automation.includes(source.id)) &&
    (rule.bot === undefined || (source.bot !== undefined && rule.bot.includes(source.bot.botId)))
  )
}

/**
 * The starts a finished run causes. An automation takes it only through an enabled bot automation's
 * own `automation.*` rule (its switch for being triggered by automations), never from itself, and
 * not past the depth limit; one past the limit comes back with its refusal so it can be recorded.
 */
export function chainStartsFor(input: {
  run: AutomationRun
  automations: readonly Automation[]
  settings: ChainSettings
  now: number
}): ChainStart[] {
  const { run, automations, settings, now } = input
  const event = chainEventOf(run)
  const source = automations.find((entry) => entry.id === run.automationId)
  if (!event || !source || !settings.enabled) {
    return []
  }
  const depth = chainDepthOfRun(run) + 1
  const text = describeRun(source, run, event)
  return automations.flatMap((target) => {
    if (target.id === source.id || !target.enabled || !target.bot) {
      return []
    }
    return (target.on ?? []).flatMap((rule) => {
      if (!isChainTrigger(rule) || !matches(rule, event, source)) {
        return []
      }
      const max = effectiveChainMaxDepth(settings.maxDepth, rule)
      return [
        {
          automationId: target.id,
          event: {
            triggerId: rule.id,
            source: 'automation',
            event,
            key: `automation:${run.id}:${event}`,
            occurredAt: now,
            actor: source.name,
            chain: { automationId: source.id, runId: run.id, depth },
            text
          } satisfies AutomationRunEvent,
          ...(depth > max
            ? {
                refusal: `Chain depth limit: this run would be ${depth} automation-started runs deep and the limit is ${max}. It followed "${source.name}".`
              }
            : {})
        }
      ]
    })
  })
}
