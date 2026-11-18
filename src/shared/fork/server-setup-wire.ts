// Set up on a server (FORK.md, SLRM-2312): the fork.serverSetup.* RPC contract shared by the
// desktop, the CLI and the server that answers.
import * as z from 'zod'
import {
  describeForkServerSetupReadiness,
  FORK_SERVER_SETUP_MAX_TEXT,
  type ForkServerSetupReadiness
} from './server-setup'

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

export const ForkServerSetupPlanSchema = z.object({
  /** Absolute parent folder on the server (`~` expanded there). */
  destination: Text,
  /** Folder created under it, from the URL. */
  folderName: Text,
  /** destination/folderName. */
  clonePath: Text,
  /** Something is already at clonePath. */
  exists: z.boolean()
})

export type ForkServerSetupPlan = z.infer<typeof ForkServerSetupPlanSchema>

/** Asked of the server once the clone is registered: what does the checkout need that it lacks? */
export const ForkServerSetupReadinessParams = z.object({
  path: Text
})

export type ForkServerSetupReadinessResult = ForkServerSetupReadiness

const Line = z.string().max(FORK_SERVER_SETUP_MAX_TEXT)

/** The readiness answer, parsed where it crosses to a phone (SLRM-2406). */
export const ForkServerSetupReadinessSchema = z.object({
  missing: z.array(Line).max(256),
  notes: z.array(Line).max(256)
})

/** Asked of this machine's Orca by the CLI: set the project up on one of its paired servers. */
export const ForkServerSetupRunParams = z.object({
  /** Paired server environment id. */
  environmentId: z.string().min(1).max(512),
  /** Project id or display name, as `--project` takes it. */
  project: z.string().min(1).max(4096),
  /** The caller checks readiness itself (the phone, so it can show that stage; SLRM-2406). */
  skipReadiness: z.boolean().optional()
})

export const ForkServerSetupRunResultSchema = z.object({
  hostKey: z.string().max(512),
  serverName: z.string().max(FORK_SERVER_SETUP_MAX_TEXT),
  /** False when the project was already set up there: nothing was cloned. */
  cloned: z.boolean(),
  clonePath: Text.nullable(),
  readiness: ForkServerSetupReadinessSchema.nullable()
})

export type ForkServerSetupRunResult = z.infer<typeof ForkServerSetupRunResultSchema>

/** How long a caller waits for fork.serverSetup.run: the clone, then the readiness check. */
export const FORK_SERVER_SETUP_RUN_TIMEOUT_MS =
  FORK_SERVER_SETUP_CLONE_TIMEOUT_MS + FORK_SERVER_SETUP_READINESS_TIMEOUT_MS

/** One line for a finished setup (batch start's acknowledgement, the phone's sheet). */
export function describeForkServerSetupRun(result: ForkServerSetupRunResult): string {
  const done = result.cloned
    ? `Set up on ${result.serverName}: cloned into ${result.clonePath}.`
    : `${result.serverName} already had the project.`
  return result.readiness ? `${done} ${describeForkServerSetupReadiness(result.readiness)}` : done
}
