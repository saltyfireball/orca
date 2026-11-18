// Set up on a server (FORK.md, SLRM-2312): the fork.serverSetup.* RPC contract shared by the
// desktop, the CLI and the server that answers.
import { z } from 'zod'
import { FORK_SERVER_SETUP_MAX_TEXT, type ForkServerSetupReadiness } from './server-setup'

export const FORK_SERVER_SETUP_PLAN_METHOD = 'fork.serverSetup.plan'
export const FORK_SERVER_SETUP_READINESS_METHOD = 'fork.serverSetup.readiness'
export const FORK_SERVER_SETUP_RUN_METHOD = 'fork.serverSetup.run'

/** A clone may take this long before the caller gives up waiting (the clone itself goes on). */
export const FORK_SERVER_SETUP_CLONE_TIMEOUT_MS = 10 * 60_000

/** Readiness runs the environment doctor's probes, each bounded by its own timeout. */
export const FORK_SERVER_SETUP_READINESS_TIMEOUT_MS = 90_000

const Text = z.string().min(1).max(FORK_SERVER_SETUP_MAX_TEXT)

/** Asked of the server: where would this URL be cloned under `parent`, and is that free? */
export const ForkServerSetupPlanParams = z.object({
  url: Text,
  parent: Text
})

export type ForkServerSetupPlan = {
  /** Absolute parent folder on the server (`~` expanded there). */
  destination: string
  /** Folder created under it, from the URL. */
  folderName: string
  /** destination/folderName. */
  clonePath: string
  /** Something is already at clonePath. */
  exists: boolean
}

/** Asked of the server once the clone is registered: what does the checkout need that it lacks? */
export const ForkServerSetupReadinessParams = z.object({
  path: Text
})

export type ForkServerSetupReadinessResult = ForkServerSetupReadiness

/** Asked of this machine's Orca by the CLI: set the project up on one of its paired servers. */
export const ForkServerSetupRunParams = z.object({
  /** Paired server environment id. */
  environmentId: z.string().min(1).max(512),
  /** Project id or display name, as `--project` takes it. */
  project: z.string().min(1).max(4096)
})

export type ForkServerSetupRunResult = {
  hostKey: string
  serverName: string
  /** False when the project was already set up there: nothing was cloned. */
  cloned: boolean
  clonePath: string | null
  readiness: ForkServerSetupReadiness | null
}
