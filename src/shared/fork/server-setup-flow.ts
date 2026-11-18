// Set up on a server (FORK.md, SLRM-2312): the one sequence both callers run. The desktop picker
// clones through the store (so the new setup lands in its lists at once); this machine's Orca runs
// it for the CLI over the paired-server link. Every step happens on the server, with its own git
// credentials: plan the folder, clone and register, then check readiness.
import {
  checkForkCloneUrl,
  checkForkSetupParent,
  type ForkServerSetupReadiness
} from './server-setup'
import type { ForkServerSetupPlan } from './server-setup-wire'

export type ForkServerSetupStage = 'planning' | 'cloning' | 'checking'

export type ForkServerSetupFlowDeps<TSetup> = {
  plan: (params: { url: string; parent: string }) => Promise<ForkServerSetupPlan>
  /** Clones the checked URL into the planned folder and registers the project; rejects on failure. */
  clone: (plan: ForkServerSetupPlan, url: string) => Promise<TSetup>
  /** Absent when readiness is off. A failure here never undoes the setup. */
  readiness?: (path: string) => Promise<ForkServerSetupReadiness>
  onStage?: (stage: ForkServerSetupStage, plan: ForkServerSetupPlan | null) => void
}

export type ForkServerSetupOutcome<TSetup> = {
  setup: TSetup
  plan: ForkServerSetupPlan
  readiness: ForkServerSetupReadiness | null
  /** Why readiness could not be read, when it was asked for and failed. */
  readinessError: string | null
}

/** An error whose message is meant for the user as is. */
export class ForkServerSetupError extends Error {}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Whether a failed call means the server's Orca has no fork.serverSetup methods. */
export function isForkMethodMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return (
    code === 'method_not_found' || /method[_ ]not[_ ]found|unknown method/i.test(message(error))
  )
}

export async function runForkServerSetup<TSetup>(
  deps: ForkServerSetupFlowDeps<TSetup>,
  request: { url: string; parent: string; serverName: string }
): Promise<ForkServerSetupOutcome<TSetup>> {
  const url = checkForkCloneUrl(request.url)
  if (!url.ok) {
    throw new ForkServerSetupError(url.reason)
  }
  const parent = checkForkSetupParent(request.parent)
  if (!parent) {
    throw new ForkServerSetupError(
      'The folder to clone into (Settings > Blackfish > Set up on a server) is not a usable path.'
    )
  }
  deps.onStage?.('planning', null)
  let plan: ForkServerSetupPlan
  try {
    plan = await deps.plan({ url: url.url, parent })
  } catch (error) {
    if (isForkMethodMissing(error)) {
      throw new ForkServerSetupError(
        `${request.serverName} runs an Orca that cannot set projects up on demand. Update it, or use Set project location.`
      )
    }
    throw error
  }
  if (plan.exists) {
    throw new ForkServerSetupError(
      `${plan.clonePath} already exists on ${request.serverName}. Use Set project location to pick that folder.`
    )
  }
  deps.onStage?.('cloning', plan)
  const setup = await deps.clone(plan, url.url)
  if (!deps.readiness) {
    return { setup, plan, readiness: null, readinessError: null }
  }
  deps.onStage?.('checking', plan)
  try {
    return { setup, plan, readiness: await deps.readiness(plan.clonePath), readinessError: null }
  } catch (error) {
    return { setup, plan, readiness: null, readinessError: message(error) }
  }
}
