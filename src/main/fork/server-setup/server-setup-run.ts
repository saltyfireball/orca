// Set up on a server (FORK.md, SLRM-2312): this machine's Orca sets a project up on one of its
// paired servers for the CLI (`worktree create --setup-missing`). It names the project's git remote
// from its own checkout, and the server does the rest with its own git credentials: the same
// plan, repo.clone, setupExistingFolder and readiness calls the desktop picker makes.
import type { Project } from '../../../shared/project/project-types'
import type { Repo } from '../../../shared/repository/repo-types'
import { normalizeTypedName } from '../../../shared/text/typed-name-normalization'
import {
  forkProjectCloneUrl,
  forkServerSetupParent,
  forkServerSetupReadinessOn,
  type ForkServerSetupReadiness,
  type ForkServerSetupSettings
} from '../../../shared/fork/server-setup'
import {
  FORK_SERVER_SETUP_CLONE_TIMEOUT_MS,
  FORK_SERVER_SETUP_PLAN_METHOD,
  FORK_SERVER_SETUP_READINESS_METHOD,
  FORK_SERVER_SETUP_READINESS_TIMEOUT_MS,
  type ForkServerSetupPlan,
  type ForkServerSetupRunResult
} from '../../../shared/fork/server-setup-wire'
import { ForkServerSetupError, runForkServerSetup } from '../../../shared/fork/server-setup-flow'

const CALL_TIMEOUT_MS = 15_000
const PROBE_TIMEOUT_MS = 5_000

export type ForkServerSetupRunDeps = {
  settings: () => ForkServerSetupSettings | null | undefined
  listEnvironments: () =>
    | readonly { id: string; name: string }[]
    | Promise<readonly { id: string; name: string }[]>
  listProjects: () => readonly Project[]
  listRepos: () => readonly Repo[]
  /** Calls a paired server's runtime and resolves with its result. */
  callEnvironment: (
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown>
}

/** A project by id, else by a display name that names exactly one. */
export function findForkProject(
  projects: readonly Project[],
  selector: string
): Project | undefined {
  const byId = projects.find((project) => project.id === selector)
  if (byId) {
    return byId
  }
  const wanted = normalizeTypedName(selector)
  const named = projects.filter((project) => normalizeTypedName(project.displayName) === wanted)
  return named.length === 1 ? named[0] : undefined
}

async function alreadyReady(
  deps: ForkServerSetupRunDeps,
  environmentId: string,
  projectId: string
): Promise<boolean> {
  try {
    const answer = await deps.callEnvironment(
      environmentId,
      'fork.placement.load',
      { project: projectId },
      PROBE_TIMEOUT_MS
    )
    return (answer as { projectReady?: unknown } | null)?.projectReady === true
  } catch {
    // An older server cannot say; the plan step decides whether the folder is free.
    return false
  }
}

export async function runForkServerSetupOnEnvironment(
  deps: ForkServerSetupRunDeps,
  params: { environmentId: string; project: string; skipReadiness?: boolean }
): Promise<ForkServerSetupRunResult> {
  const environment = (await deps.listEnvironments()).find(
    (entry) => entry.id === params.environmentId
  )
  if (!environment) {
    throw new ForkServerSetupError(`No paired server has the id ${params.environmentId}.`)
  }
  const project = findForkProject(deps.listProjects(), params.project)
  if (!project) {
    throw new ForkServerSetupError(`No project here matches ${params.project}.`)
  }
  const hostKey = `runtime:${environment.id}`
  const base = { hostKey, serverName: environment.name }
  if (await alreadyReady(deps, environment.id, project.id)) {
    return { ...base, cloned: false, clonePath: null, readiness: null }
  }
  const settings = deps.settings()
  const call = (method: string, callParams: unknown, timeoutMs = CALL_TIMEOUT_MS) =>
    deps.callEnvironment(environment.id, method, callParams, timeoutMs)
  const url = forkProjectCloneUrl(project, deps.listRepos())
  const outcome = await runForkServerSetup(
    {
      plan: async (planParams) =>
        (await call(FORK_SERVER_SETUP_PLAN_METHOD, planParams)) as ForkServerSetupPlan,
      clone: async (plan, checkedUrl) => {
        const cloned = (await call(
          'repo.clone',
          { url: checkedUrl, destination: plan.destination, folderName: plan.folderName },
          FORK_SERVER_SETUP_CLONE_TIMEOUT_MS
        )) as { repo?: { path?: unknown } } | null
        const path = typeof cloned?.repo?.path === 'string' ? cloned.repo.path : plan.clonePath
        await call('projectHostSetup.setupExistingFolder', {
          projectId: project.id,
          ...(project.providerIdentity
            ? { projectProviderIdentity: project.providerIdentity }
            : {}),
          hostId: hostKey,
          path,
          kind: 'git',
          displayName: project.displayName,
          setupMethod: 'cloned'
        })
        return path
      },
      ...(forkServerSetupReadinessOn(settings) && !params.skipReadiness
        ? {
            readiness: async (path: string) =>
              (await call(
                FORK_SERVER_SETUP_READINESS_METHOD,
                { path },
                FORK_SERVER_SETUP_READINESS_TIMEOUT_MS
              )) as ForkServerSetupReadiness
          }
        : {})
    },
    { url, parent: forkServerSetupParent(settings), serverName: environment.name }
  )
  return {
    ...base,
    cloned: true,
    clonePath: outcome.setup,
    readiness:
      outcome.readiness ??
      (outcome.readinessError
        ? { missing: [], notes: [`Readiness check failed: ${outcome.readinessError}`] }
        : null)
  }
}
