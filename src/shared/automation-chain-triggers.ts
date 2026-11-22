// Fork (BAD-689, FORK.md "Automation run triggers"): an automation that starts when another
// automation's run finishes or fails. Matched on this host, never sent to Orca Cloud, so an older
// cloud never sees the rule.

export const CHAIN_EVENT_SOURCE = 'automation' as const

export const CHAIN_EVENTS = ['run_succeeded', 'run_failed'] as const
export type ChainEvent = (typeof CHAIN_EVENTS)[number]

/** Settings key: chained runs on or off for this host. Unset is on. */
export const CHAIN_ENABLED_SETTING = 'forkAutomationChaining'
/** Settings key: the longest chain of automation-started runs, counted from the first run a person or schedule started. */
export const CHAIN_MAX_DEPTH_SETTING = 'forkAutomationChainMaxDepth'
export const DEFAULT_CHAIN_MAX_DEPTH = 3
export const MAX_CHAIN_MAX_DEPTH = 10

const MAX_FILTER_LENGTH = 200
const MAX_FILTER_VALUES = 10

/**
 * A rule that starts the automation when another's run ends. Having one is the automation's
 * "can be triggered by automations" switch: without one nothing chains into it.
 */
export type AutomationChainTrigger = {
  id: string
  source: typeof CHAIN_EVENT_SOURCE
  event: ChainEvent
  /** Only runs of these automations, by id; absent means any automation but this one. */
  automation?: string[]
  /** Only runs of automations that belong to these bots, by bot id. */
  bot?: string[]
  /** This rule's own depth limit, never above the host's setting; absent follows the setting. */
  maxDepth?: number
}

export function isChainTrigger<Rule extends { source: string }>(
  trigger: Rule
): trigger is Extract<Rule, { source: typeof CHAIN_EVENT_SOURCE }> {
  return trigger.source === CHAIN_EVENT_SOURCE
}

export function assertChainTrigger(trigger: AutomationChainTrigger): void {
  const texts = [...(trigger.automation ?? []), ...(trigger.bot ?? [])]
  if (
    texts.some((text) => text.length > MAX_FILTER_LENGTH) ||
    (trigger.automation?.length ?? 0) > MAX_FILTER_VALUES ||
    (trigger.bot?.length ?? 0) > MAX_FILTER_VALUES
  ) {
    throw new Error(`The ${trigger.source}.${trigger.event} trigger's filters are too long.`)
  }
  if (
    trigger.maxDepth !== undefined &&
    (!Number.isInteger(trigger.maxDepth) ||
      trigger.maxDepth < 1 ||
      trigger.maxDepth > MAX_CHAIN_MAX_DEPTH)
  ) {
    throw new Error(`automation.${trigger.event} takes depth= 1 to ${MAX_CHAIN_MAX_DEPTH}.`)
  }
}

/** The depth limit that applies: the host's setting, narrowed by the rule's own. */
export function effectiveChainMaxDepth(
  settingDepth: number | undefined,
  rule: Pick<AutomationChainTrigger, 'maxDepth'>
): number {
  const host =
    settingDepth !== undefined &&
    Number.isInteger(settingDepth) &&
    settingDepth >= 1 &&
    settingDepth <= MAX_CHAIN_MAX_DEPTH
      ? settingDepth
      : DEFAULT_CHAIN_MAX_DEPTH
  return Math.min(host, rule.maxDepth ?? host)
}

export type ForkAutomationChainSettings = {
  /** Fork (BAD-689): automations can start on another automation's run finishing or failing; false stops every chained start on this host. Unset is true. */
  forkAutomationChaining?: boolean
  /** Fork (BAD-689): the longest chain of automation-started runs (1 to 10); a run that would be deeper is recorded as skipped. Unset is 3. */
  forkAutomationChainMaxDepth?: number
}
