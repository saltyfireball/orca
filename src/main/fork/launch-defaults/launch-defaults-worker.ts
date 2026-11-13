// Fork launch defaults for orchestration workers: fill worker-start's model and effort, mark the
// receipt, and read that receipt back for the worker row tooltip.
import type { TuiAgent } from '../../../shared/agent-launch/catalog/tui-agent'
import type { ForkAgentRowLaunch } from '../../../shared/fork/launch-defaults/launch-defaults-row'
import { resolveForkLaunchChoice } from '../../../shared/fork/launch-defaults/launch-defaults-resolve'
import { readForkLaunchDefaults, type ForkLaunchSettingsHost } from './launch-defaults-apply'

type WorkerPreferencesArgs = {
  agent: TuiAgent
  openCodeModelLaunchSupported?: boolean
  createsWorktree?: boolean
  model?: string
  effort?: string
}

/** Wrap upstream's worker preference check: with no --model/--effort the kind's default fills in,
 *  and the receipt says so (`forkDefault`), which persists with the dispatch's start options. */
export function resolveForkWorkerLaunch<R extends { receipt: object }>(
  runtime: ForkLaunchSettingsHost,
  args: WorkerPreferencesArgs,
  resolve: (args: WorkerPreferencesArgs) => R
): R {
  const choice = resolveForkLaunchChoice({
    settings: readForkLaunchDefaults(runtime),
    kind: 'worker',
    agent: args.agent,
    explicitModel: args.model,
    explicitEffort: args.effort,
    createsWorktree: args.createsWorktree
  })
  if (choice.source !== 'fork-default') {
    return resolve(args)
  }
  const launch = resolve({ ...args, model: choice.model, effort: choice.effort })
  return { ...launch, receipt: { ...launch.receipt, forkDefault: 'worker' } }
}

type WorkerDispatchReader = {
  getWorkerDispatch?: (dispatchId: string) => { start_options: string } | undefined | null
}

function selection(value: unknown): { model?: string; effort?: string } {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const { model, effort } = value as { model?: unknown; effort?: unknown }
  return {
    ...(typeof model === 'string' && model ? { model } : {}),
    ...(typeof effort === 'string' && effort ? { effort } : {})
  }
}

/** The worker's model and effort from its saved start options, for the sidebar row. */
export function forkWorkerRowLaunch(
  db: WorkerDispatchReader | null | undefined,
  dispatchId: string
): { forkLaunch: ForkAgentRowLaunch } | Record<string, never> {
  try {
    const json = db?.getWorkerDispatch?.(dispatchId)?.start_options
    const launch = json ? (JSON.parse(json) as { launch?: Record<string, unknown> }).launch : null
    if (!launch || typeof launch !== 'object') {
      return {}
    }
    const effective = selection(launch.effective)
    const requested = selection(launch.requested)
    const source =
      launch.forkDefault === 'worker' ? 'fork-default' : requested.model ? 'explicit' : 'stock'
    return { forkLaunch: { ...(effective.model ? effective : requested), source } }
  } catch {
    return {}
  }
}
