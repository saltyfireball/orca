// Agent guards (FORK.md, BAD-679 "Spend caps for every agent"): what the ledger says about a
// Run (a coordinator and its workers) and about an automation's runs, for the caps that cover
// them. `configureAgentGuardScopes` is given the settings, the store and an agent's own spend by
// the service. Keep electron out of this file.
import type { Automation } from '../../../shared/automations/automation-definition'
import type { AutomationRun } from '../../../shared/automations/history/automation-run'
import { agentGuardLabel, type AgentGuardSettings } from '../../../shared/fork/agent-guards'
import type {
  ForkGuardsAutomationCapResult,
  ForkGuardsListResult,
  ForkGuardsAutomationRow,
  ForkGuardsRunRow
} from '../../../shared/fork/agent-guards-wire'
import { forkAgentQueueWorkerParent } from '../agent-queue/agent-queue-service'
import { buildRunIndex, type RunIndex } from './agent-guards-run-index'
import { forkUsageLedgerData, forkUsageLedgerSettings } from '../usage-ledger/usage-ledger-service'
import { cleanUsagePrices, estimateChatCostUsd, usagePricer } from '../usage-ledger/usage-report'
import {
  anyAutomationCap,
  automationCapRefusal,
  automationSpend,
  automationWindows,
  effectiveAutomationCaps
} from './automation-caps'
import {
  applyAutomationCapChange,
  readAutomationCapOverrides,
  writeAutomationCapOverrides,
  type AutomationCapOverrides
} from './automation-caps-state'
import type { AgentGuardEngine } from './agent-guards-engine'
import type {
  AgentGuardAutomationSpend,
  AgentGuardRun,
  AgentGuardSpend
} from './agent-guards-types'

export type AgentGuardScopesStore = {
  listAutomationRuns?: (automationId: string) => AutomationRun[]
  listAutomations?: () => Automation[]
}

type Config = {
  settings: () => AgentGuardSettings
  store: () => AgentGuardScopesStore | null
}

let config: Config | null = null
let overrides: AutomationCapOverrides = new Map()
let overridesPath: string | null = null
let liveIds: ReadonlySet<string> = new Set()

export function configureAgentGuardScopes(next: Config): void {
  config = next
}

/** Loads the automations' own caps from the data folder; call once before they are read. */
export async function loadAgentGuardScopeState(path: string): Promise<void> {
  overridesPath = path
  overrides = await readAutomationCapOverrides(path)
}

/** The agents running now: only these can be paused as members of a Run. */
export function setAgentGuardLiveIds(ids: ReadonlySet<string>): void {
  liveIds = ids
}

function pricer() {
  return usagePricer(cleanUsagePrices(forkUsageLedgerSettings()?.forkUsagePrices))
}

/** Estimated spend from the usage ledger, priced as the usage report prices it. */
export function agentGuardSpendOf(sessionId: string): AgentGuardSpend {
  const chat = forkUsageLedgerData()?.chats[sessionId]
  const isWorker = Boolean(chat?.parentSessionId ?? forkAgentQueueWorkerParent(sessionId))
  return {
    totalUsd: chat ? estimateChatCostUsd(chat, pricer()) : null,
    isWorker
  }
}

let runIndexCache: { at: number; index: RunIndex } | null = null
const RUN_INDEX_TTL_MS = 2000

function runIndex(): RunIndex {
  const data = forkUsageLedgerData()
  if (!data) {
    return new Map()
  }
  const now = Date.now()
  if (!runIndexCache || now - runIndexCache.at > RUN_INDEX_TTL_MS) {
    runIndexCache = { at: now, index: buildRunIndex(data, liveIds) }
  }
  return runIndexCache.index
}

/** The multi-agent Run this agent belongs to, or null when it is on its own. */
export function agentGuardRunOf(id: string): AgentGuardRun | null {
  return runIndex().get(id) ?? null
}

/** Runs with a cap, for `orca guards list`. */
export function agentGuardRunRows(
  capOf: (rootId: string) => number | null,
  spentOf: (rootId: string, totalUsd: number) => number
): ForkGuardsRunRow[] {
  const rows = new Map<string, ForkGuardsRunRow>()
  for (const run of runIndex().values()) {
    const cap = capOf(run.rootId)
    if (cap !== null && !rows.has(run.rootId)) {
      rows.set(run.rootId, {
        rootId: run.rootId,
        title: agentGuardLabel(run.title, 60),
        agents: run.memberIds.length,
        ...((run.uncounted ?? 0) > 0 ? { uncounted: run.uncounted } : {}),
        spentUsd: spentOf(run.rootId, run.totalUsd),
        capUsd: cap
      })
    }
  }
  return [...rows.values()]
}

function storeOf(): AgentGuardScopesStore | null {
  try {
    return config?.store() ?? null
  } catch {
    return null
  }
}

function capsOf(automationId: string) {
  const settings = config?.settings()
  return settings ? effectiveAutomationCaps(settings, overrides.get(automationId)) : null
}

/** What an automation's runs spent today and over 7 days; the ledger's days, else recorded costs. */
function windowsOf(automationId: string, now: number) {
  const data = forkUsageLedgerData()
  const runs = storeOf()?.listAutomationRuns?.(automationId) ?? []
  return automationWindows(
    automationSpend(runs, (key) => data?.chats[key], pricer()),
    now
  )
}

/** True when an agent started by this automation is covered by one of its caps. */
export function automationHasCaps(automationId: string): boolean {
  const caps = capsOf(automationId)
  return caps !== null && anyAutomationCap(caps)
}

/** The automation caps that cover an agent one of its runs started, with their spend. */
export function agentGuardAutomationLimits(
  id: string,
  automationId: string
): AgentGuardAutomationSpend[] {
  const caps = capsOf(automationId)
  if (!caps) {
    return []
  }
  const limits: AgentGuardAutomationSpend[] = []
  const own = agentGuardSpendOf(id).totalUsd
  if (caps.runUsd > 0 && own !== null) {
    limits.push({
      scope: 'automation-run',
      capUsd: caps.runUsd,
      spentUsd: own
    })
  }
  if (caps.dayUsd > 0 || caps.weekUsd > 0) {
    const windows = windowsOf(automationId, Date.now())
    if (caps.dayUsd > 0) {
      limits.push({
        scope: 'automation-day',
        capUsd: caps.dayUsd,
        spentUsd: windows.dayUsd
      })
    }
    if (caps.weekUsd > 0) {
      limits.push({
        scope: 'automation-week',
        capUsd: caps.weekUsd,
        spentUsd: windows.weekUsd
      })
    }
  }
  return limits
}

/**
 * Hook (automation dispatch): why a run about to launch must be skipped because its automation
 * spent its daily or weekly cap, or null. A person's own Run now is never refused.
 */
export function forkAutomationCapRefusal(
  automationId: string,
  trigger: 'scheduled' | 'manual' | 'event'
): string | null {
  const caps = capsOf(automationId)
  if (!caps || trigger === 'manual' || (caps.dayUsd <= 0 && caps.weekUsd <= 0)) {
    return null
  }
  try {
    return automationCapRefusal(caps, windowsOf(automationId, Date.now()))
  } catch (error) {
    // A broken cap check never stops an automation.
    console.warn('[fork-agent-guards] could not check automation caps', error)
    return null
  }
}

/** Automations with caps, for `orca guards list`. */
export function agentGuardAutomationRows(now: number): ForkGuardsAutomationRow[] {
  const rows: ForkGuardsAutomationRow[] = []
  for (const automation of storeOf()?.listAutomations?.() ?? []) {
    const caps = capsOf(automation.id)
    if (!caps || !anyAutomationCap(caps)) {
      continue
    }
    const windows = windowsOf(automation.id, now)
    rows.push({
      id: automation.id,
      name: agentGuardLabel(automation.name, 60),
      runCapUsd: caps.runUsd,
      dayCapUsd: caps.dayUsd,
      weekCapUsd: caps.weekUsd,
      daySpentUsd: Math.round(windows.dayUsd * 100) / 100,
      weekSpentUsd: Math.round(windows.weekUsd * 100) / 100,
      skipping: automationCapRefusal(caps, windows) !== null
    })
  }
  return rows
}

/** `orca guards automation-cap`: one automation's own caps; throws for an unknown automation. */
export async function setAgentGuardAutomationCap(
  automationId: string,
  change: {
    runUsd?: number | null
    dayUsd?: number | null
    weekUsd?: number | null
  }
): Promise<ForkGuardsAutomationCapResult> {
  if (!overridesPath) {
    throw new Error('Agent guards are not running on this host yet; try again in a moment.')
  }
  // Called on the store: a class-backed store fails when the method is taken off it.
  const known = storeOf()?.listAutomations?.()
  if (known && !known.some((entry) => entry.id === automationId)) {
    throw new Error(
      `No automation "${automationId.slice(0, 80)}" on this host. Run "orca automation list" for ids.`
    )
  }
  applyAutomationCapChange(overrides, automationId, change)
  await writeAutomationCapOverrides(overridesPath, overrides)
  const caps = capsOf(automationId)
  return {
    id: automationId,
    runCapUsd: caps?.runUsd ?? 0,
    dayCapUsd: caps?.dayUsd ?? 0,
    weekCapUsd: caps?.weekUsd ?? 0
  }
}

/** Hook (automation launch): the agent a run started, so its automation's caps cover it. */
export function noteAgentGuardAutomationLaunch(
  engine: AgentGuardEngine | null,
  automationId: string,
  launched: { chatSessionId?: string | null; terminalPaneKey?: string | null }
): void {
  if (!engine || !automationHasCaps(automationId)) {
    return
  }
  const chat = launched.chatSessionId
  const id = chat ?? launched.terminalPaneKey
  if (id) {
    void engine.noteAutomation(id, chat ? 'chat' : 'terminal', automationId).catch((error) => {
      console.warn('[fork-agent-guards] could not note an automation run', error)
    })
  }
}

/** `orca guards list`: the guarded agents, the Runs with a cap and the automations with caps. */
export function agentGuardList(engine: AgentGuardEngine | null): ForkGuardsListResult {
  const now = Date.now()
  return {
    now,
    entries: engine?.entries() ?? [],
    runs: agentGuardRunRows(
      (rootId) => engine?.caps.runCapOf(rootId) ?? null,
      (rootId, total) => engine?.caps.runSpentOf(rootId, total) ?? total
    ),
    automations: agentGuardAutomationRows(now)
  }
}
