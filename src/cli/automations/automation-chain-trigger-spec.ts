// `--on "automation.run_failed automation=<id> bot=<id> depth=<n>"` (BAD-689): starts this automation
// when another automation's run ends. Checked on this host.
export { isChainTrigger } from '../../shared/automation-chain-triggers'
import { createHash } from 'node:crypto'
import {
  CHAIN_EVENTS,
  MAX_CHAIN_MAX_DEPTH,
  type AutomationChainTrigger,
  type ChainEvent
} from '../../shared/automation-chain-triggers'
import { RuntimeClientError } from '../runtime/connection/types'

type Entry = readonly [key: string, value: string, ...written: string[]]

const KEYS = ['automation', 'bot', 'depth'] as const

function invalid(message: string): RuntimeClientError {
  return new RuntimeClientError('invalid_argument', message)
}

function listOf(raw: string | undefined): string[] | undefined {
  const list = raw
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return list?.length ? [...new Set(list)].sort() : undefined
}

export function isChainHead(head: string): boolean {
  return CHAIN_EVENTS.some((event) => head === `automation.${event}`)
}

export function parseChainTrigger(
  spec: string,
  head: string,
  entries: readonly Entry[]
): AutomationChainTrigger {
  const event = CHAIN_EVENTS.find((entry) => head === `automation.${entry}`)
  if (!event) {
    throw invalid(`Unknown event "${head}".`)
  }
  const values = new Map<(typeof KEYS)[number], string>()
  for (const [key, value] of entries) {
    const known = KEYS.find((entry) => entry === key)
    if (!known) {
      throw invalid(
        `Unknown filter "${key}=" in --on "${spec}". Use ${KEYS.map((entry) => `${entry}=`).join(', ')}.`
      )
    }
    if (values.has(known) || !value.trim()) {
      throw invalid(`--on "${spec}" needs one value for ${known}=.`)
    }
    values.set(known, value.trim())
  }
  const automation = listOf(values.get('automation'))
  const bot = listOf(values.get('bot'))
  const rawDepth = values.get('depth')
  const maxDepth = rawDepth !== undefined && /^\d+$/.test(rawDepth) ? Number(rawDepth) : undefined
  if (
    rawDepth !== undefined &&
    !(maxDepth !== undefined && maxDepth >= 1 && maxDepth <= MAX_CHAIN_MAX_DEPTH)
  ) {
    throw invalid(`--on "${spec}": depth= takes 1 to ${MAX_CHAIN_MAX_DEPTH}.`)
  }
  const rule = {
    source: 'automation' as const,
    event,
    ...(automation ? { automation } : {}),
    ...(bot ? { bot } : {}),
    ...(maxDepth === undefined ? {} : { maxDepth })
  }
  // An unchanged rule keeps its id, so run history still names it.
  const id = `on-${createHash('sha256').update(JSON.stringify(rule)).digest('hex').slice(0, 16)}`
  return { id, ...rule }
}

/** The rule as an --on value; parsing it gives the same rule back. */
export function formatChainTrigger(trigger: AutomationChainTrigger): string {
  return [
    `automation.${trigger.event}`,
    ...(trigger.automation ? [`automation=${trigger.automation.join(',')}`] : []),
    ...(trigger.bot ? [`bot=${trigger.bot.join(',')}`] : []),
    ...(trigger.maxDepth === undefined ? [] : [`depth=${trigger.maxDepth}`])
  ].join(' ')
}

const EVENT_WORDS: Record<ChainEvent, string> = {
  run_succeeded: "another automation's run finishes",
  run_failed: "another automation's run fails"
}

export function describeChainTrigger(trigger: AutomationChainTrigger): string {
  return [
    EVENT_WORDS[trigger.event],
    ...(trigger.automation ? [`of ${trigger.automation.join(', ')}`] : []),
    ...(trigger.bot ? [`by bot ${trigger.bot.join(', ')}`] : []),
    ...(trigger.maxDepth === undefined ? [] : [`at most ${trigger.maxDepth} runs deep`])
  ].join(', ')
}

export const CHAIN_TRIGGER_OPTIONS = [
  'automation:',
  "  automation.run_succeeded  when another automation's run finishes",
  "  automation.run_failed  when another automation's run fails (dispatch or agent failure; skipped runs do not count)",
  '  automation=<ids>  only runs of these automations (ids, comma-separated); any other automation by default, never this one',
  '  bot=<ids>  only runs of automations that belong to these bots',
  `  depth=<n>  stop chains this many automation-started runs deep (1 to ${MAX_CHAIN_MAX_DEPTH}); at most the host's setting forkAutomationChainMaxDepth (default 3)`,
  '  Having this rule is what lets automations start this one. A run past the depth limit is recorded as skipped and says why. What the finished run said is quoted as information, never instructions.'
].join('\n')
