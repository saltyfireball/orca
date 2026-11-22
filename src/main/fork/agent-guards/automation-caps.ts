// BAD-679 (FORK.md "Spend caps for every agent"): spend caps of automations, per run, per local
// day and per 7 days. The run cap pauses the run's agent through the agent guards; the day and week
// caps skip further runs until the window moves on or the cap is raised, and pause a run in
// progress. Spend is what the usage ledger holds for each run's chat or terminal, else the cost the
// run recorded when it finished. Pure: the clock, the day key and the prices are passed in.
import type { AgentGuardSettings } from '../../../shared/fork/agent-guards'
import { localDayKey, type UsageChatRecord } from '../usage-ledger/usage-ledger-model'
import type { UsagePricer } from '../usage-ledger/usage-report'

export type AutomationCaps = { runUsd: number; dayUsd: number; weekUsd: number }

/** One automation's own caps, over the defaults; a key left out follows the default, 0 is off. */
export type AutomationCapOverride = Partial<AutomationCaps>

/** The part of a run the caps read. */
export type AutomationCapRun = {
  createdAt: number
  dispatchedAt: number | null
  chatSessionId: string | null
  terminalPaneKey: string | null
  usage: { status: string; estimatedCostUsd: number | null } | null
}

const DAY_MS = 86_400_000
export const AUTOMATION_CAP_WEEK_DAYS = 7

export function effectiveAutomationCaps(
  settings: Pick<
    AgentGuardSettings,
    'automationRunCapUsd' | 'automationDayCapUsd' | 'automationWeekCapUsd'
  >,
  override: AutomationCapOverride | undefined
): AutomationCaps {
  return {
    runUsd: override?.runUsd ?? settings.automationRunCapUsd,
    dayUsd: override?.dayUsd ?? settings.automationDayCapUsd,
    weekUsd: override?.weekUsd ?? settings.automationWeekCapUsd
  }
}

export function anyAutomationCap(caps: AutomationCaps): boolean {
  return caps.runUsd > 0 || caps.dayUsd > 0 || caps.weekUsd > 0
}

/** A chat's estimated USD by local day, priced like the usage report. */
export function chatCostByDay(
  chat: Pick<UsageChatRecord, 'days'>,
  pricer: UsagePricer
): Map<string, number> {
  const byDay = new Map<string, number>()
  for (const [day, models] of Object.entries(chat.days)) {
    let total = 0
    for (const [model, cell] of Object.entries(models)) {
      total += pricer(model, cell.tokens) ?? 0
    }
    byDay.set(day, total)
  }
  return byDay
}

/**
 * What an automation's runs spent, by local day. A run whose agent the ledger knows counts what the ledger
 * holds, day by day; any other run counts the cost it recorded, on the day it launched.
 */
export function automationSpend(
  runs: readonly AutomationCapRun[],
  chatOf: (agentKey: string) => Pick<UsageChatRecord, 'days'> | undefined,
  pricer: UsagePricer,
  dayKey: (ms: number) => string = localDayKey
): Map<string, number> {
  const byDay = new Map<string, number>()
  const add = (day: string, usd: number): void => {
    byDay.set(day, (byDay.get(day) ?? 0) + usd)
  }
  const counted = new Set<string>()
  for (const run of runs) {
    const key = run.chatSessionId ?? run.terminalPaneKey
    const chat = key ? chatOf(key) : undefined
    if (key && chat) {
      if (counted.has(key)) {
        // A reused session is one agent: its spend counts once.
        continue
      }
      counted.add(key)
      for (const [day, usd] of chatCostByDay(chat, pricer)) {
        add(day, usd)
      }
    } else if (run.usage?.status === 'known' && (run.usage.estimatedCostUsd ?? 0) > 0) {
      add(dayKey(run.dispatchedAt ?? run.createdAt), run.usage.estimatedCostUsd ?? 0)
    }
  }
  return byDay
}

export type AutomationWindows = { dayUsd: number; weekUsd: number }

/** Spend today (local day) and over the last 7 local days, today included. */
export function automationWindows(
  byDay: ReadonlyMap<string, number>,
  now: number,
  dayKey: (ms: number) => string = localDayKey
): AutomationWindows {
  let weekUsd = 0
  for (let back = 0; back < AUTOMATION_CAP_WEEK_DAYS; back += 1) {
    weekUsd += byDay.get(dayKey(now - back * DAY_MS)) ?? 0
  }
  return { dayUsd: byDay.get(dayKey(now)) ?? 0, weekUsd }
}

const money = (usd: number): string => `$${usd.toFixed(2)}`

/** Why a new run must be skipped, or null when it may go. Fixed wording: no run content in it. */
export function automationCapRefusal(
  caps: AutomationCaps,
  windows: AutomationWindows
): string | null {
  if (caps.dayUsd > 0 && windows.dayUsd >= caps.dayUsd) {
    return `Skipped: this automation's runs spent ${money(windows.dayUsd)} today, past its daily spend cap of ${money(caps.dayUsd)}. Runs resume when the day changes or the cap is raised.`
  }
  if (caps.weekUsd > 0 && windows.weekUsd >= caps.weekUsd) {
    return `Skipped: this automation's runs spent ${money(windows.weekUsd)} over the last 7 days, past its weekly spend cap of ${money(caps.weekUsd)}. Runs resume when older spend ages out or the cap is raised.`
  }
  return null
}
