// Own pull request loop limit (BAD-819, FORK.md "Own pull request loop limit"). Since upstream
// v1.4.273 a from=me github.pr_opened rule starts on every pull request opened under the owner's
// account, agents' included, so a run that opens one starts its own automation again. A start whose
// pull request a run of the same automation opened is one hop deeper than that run and stops past
// forkAutomationChainMaxDepth; any own pull request start past the window cap stops too. A stop is a
// skipped run with the reason. The delivery's head branch is only compared, never checked out or run.
import { randomUUID } from 'node:crypto'
import {
  CHAIN_MAX_DEPTH_SETTING,
  effectiveChainMaxDepth
} from '../../../shared/automation-chain-triggers'
import { takesOwnEvents, type AutomationRunEvent } from '../../../shared/automation-event-triggers'
import type { Automation } from '../../../shared/automations/automation-definition'
import type { AutomationRun } from '../../../shared/automations/history/automation-run'
import type { ConnectorDelivery } from '../../../shared/connectors/connector-cloud-contract'
import { withTimeout } from '../../../shared/concurrency/promise-timeout-fallback'
import { chainDepthOfRun } from '../../automations/automation-chain-runs'
import type { EventStartGate } from '../../automations/automation-trigger-runs'
import { normalizeLocalBranchName } from '../../runtime/workspaces/catalog/runtime-worktree-selection'

type TriggerDelivery = Extract<ConnectorDelivery, { kind: 'trigger' }>

// Few people open more than this many pull requests by hand in this long.
export const OWN_PR_STARTS_PER_WINDOW = 5
export const OWN_PR_WINDOW_MS = 15 * 60_000
// The newest runs whose work may have opened the pull request; older ones' pull requests came long ago.
const OPENER_RUNS_READ = 20
// A slow workspace read never holds the delivery: the opener is then unknown and the cap still holds.
const OPENER_READ_TIMEOUT_MS = 3_000

export const OWN_PR_LOOP_REASON = 'Own pull request loop limit:'
export const OWN_PR_CAP_REASON = 'Own pull request cap:'

export type OwnPrLoopStore = {
  listAutomationRuns(automationId: string): readonly AutomationRun[]
  getSettings(): unknown
}

export type OwnPrLoopDeps = {
  store: OwnPrLoopStore
  /** The branches a run's own work has checked out (its workers' workspaces); null when unreadable. */
  runBranches(run: AutomationRun): Promise<readonly string[] | null>
  runForEvent(
    automationId: string,
    event: AutomationRunEvent,
    gate?: EventStartGate
  ): Promise<AutomationRun | null>
  /** A start was stopped: the inbox reads again. */
  stopped(): void
  now?: () => number
}

function isSkipped(run: Pick<AutomationRun, 'status'>): boolean {
  return run.status.startsWith('skipped_')
}

/** An own pull request start: the event a from=me rule takes, stamped as the owner's. */
export function isOwnPrStart(event: AutomationRunEvent | undefined): boolean {
  return event?.source === 'github' && event.fromOwner === true && takesOwnEvents(event)
}

export function isOwnPrLoopSkip(run: Pick<AutomationRun, 'status' | 'error'>): boolean {
  return (
    run.status === 'skipped_unavailable' &&
    (run.error?.startsWith(OWN_PR_LOOP_REASON) === true ||
      run.error?.startsWith(OWN_PR_CAP_REASON) === true)
  )
}

/** The run of this automation whose work has the pull request's head branch, deepest first; null
 *  when no run's work can be told to have it. */
async function openerOf(
  deps: OwnPrLoopDeps,
  automationId: string,
  headRef: string
): Promise<AutomationRun | null> {
  const wanted = normalizeLocalBranchName(headRef)
  const runs = deps.store
    .listAutomationRuns(automationId)
    .filter((run) => !isSkipped(run) && (run.chatSessionId || run.workspaceId))
    .toSorted((a, b) => b.createdAt - a.createdAt)
    .slice(0, OPENER_RUNS_READ)
  let opener: AutomationRun | null = null
  for (const run of runs) {
    const branches = await deps.runBranches(run).catch(() => null)
    const opened = branches?.some((branch) => normalizeLocalBranchName(branch) === wanted)
    if (opened && (!opener || chainDepthOfRun(run) > chainDepthOfRun(opener))) {
      opener = run
    }
  }
  return opener
}

function maxDepth(store: OwnPrLoopStore): number {
  const settings = store.getSettings()
  const setting =
    typeof settings === 'object' && settings !== null && CHAIN_MAX_DEPTH_SETTING in settings
      ? settings[CHAIN_MAX_DEPTH_SETTING]
      : undefined
  return effectiveChainMaxDepth(typeof setting === 'number' ? setting : undefined, {})
}

/** Why this own pull request may not start the automation now, or null when it may. */
function refusalOf(
  deps: OwnPrLoopDeps,
  automation: Pick<Automation, 'id'>,
  opener: AutomationRun | null
): string | null {
  if (opener) {
    const depth = chainDepthOfRun(opener) + 1
    const max = maxDepth(deps.store)
    if (depth > max) {
      const after = opener.runNumber ? ` It followed run ${opener.runNumber}.` : ''
      return `${OWN_PR_LOOP_REASON} this run would be ${depth} runs deep, each started by a pull request the run before it opened, and the limit is ${max} (forkAutomationChainMaxDepth).${after}`
    }
  }
  const since = (deps.now?.() ?? Date.now()) - OWN_PR_WINDOW_MS
  const recent = deps.store
    .listAutomationRuns(automation.id)
    .filter(
      (run) =>
        run.trigger === 'event' &&
        !isSkipped(run) &&
        run.createdAt >= since &&
        isOwnPrStart(run.event)
    ).length
  return recent >= OWN_PR_STARTS_PER_WINDOW
    ? `${OWN_PR_CAP_REASON} ${recent} of your own pull requests started this automation in the last ${OWN_PR_WINDOW_MS / 60_000} minutes, the most it takes, so this one started nothing.`
    : null
}

/**
 * Starts the automation on a trigger's event. An own pull request is checked in the automation's
 * lane, after resends and folds and just before its run is made, so pull requests delivered together
 * are counted one by one and a resend uses none of the cap. Any other event passes untouched.
 */
export async function runOwnPrLoopGuarded(
  deps: OwnPrLoopDeps,
  automationId: string,
  event: AutomationRunEvent,
  delivery: Pick<TriggerDelivery, 'event'>
): Promise<AutomationRun | null> {
  if (!isOwnPrStart(event)) {
    return await deps.runForEvent(automationId, event)
  }
  const head = delivery.event.pr?.headRef
  const opener = head
    ? await withTimeout(
        openerOf(deps, automationId, head).catch(() => null),
        OPENER_READ_TIMEOUT_MS,
        null
      )
    : null
  // The depth is this host's own count, never the delivery's.
  const { chain: _untrusted, ...own } = event
  const gate: EventStartGate = {
    reserve: async (automation) => {
      const skipped = refusalOf(deps, automation, opener)
      if (skipped) {
        console.info(`[fork own pr loop] an own pull request started nothing: ${skipped}`)
        return { refused: true, skipped }
      }
      const chain = opener
        ? { automationId: automation.id, runId: opener.id, depth: chainDepthOfRun(opener) + 1 }
        : undefined
      return { event: chain ? { ...own, chain } : own, runId: randomUUID() }
    },
    created: () => {}
  }
  const run = await deps.runForEvent(automationId, own, gate)
  if (run && isOwnPrLoopSkip(run)) {
    deps.stopped()
  }
  return run
}
