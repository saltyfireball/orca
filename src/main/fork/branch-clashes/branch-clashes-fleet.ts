// Branch clashes (FORK.md, SLRM-2394): this machine's report plus each paired server's own, folded
// into clashes. Each server reads its own git over `fork.clashes.local`, the way auto placement
// asks each server for its own load (auto-placement-probe.ts).
import { mapWithConcurrency } from '../../../shared/concurrency/map-with-concurrency'
import {
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId
} from '../../../shared/execution-host/execution-host'
import {
  buildForkClashes,
  FORK_CLASHES_MAX_FILES_PER_BRANCH,
  type ForkBranchClashConfig,
  type ForkClashHostReport,
  type ForkClashHostResult,
  type ForkClashRepo,
  type ForkClashResult
} from '../../../shared/fork/branch-clashes'
import { FORK_CLASHES_HOST_TIMEOUT_MS } from '../../../shared/fork/branch-clashes-wire'

const HOST_CONCURRENCY = 4
/** Bounds on what one server's answer may hold; the rest is dropped. */
const MAX_REPOS = 200
const MAX_BRANCHES_PER_REPO = 500
const MAX_TEXT = 4096
const LOCAL_NAME = 'this machine'

export type ForkClashFleetDeps = {
  config: () => ForkBranchClashConfig
  localReport: (project: string | undefined) => Promise<ForkClashHostReport>
  listEnvironments: () =>
    | readonly { id: string; name: string }[]
    | Promise<readonly { id: string; name: string }[]>
  /** Calls a paired server's runtime; rejects with an error carrying `code` on failure. */
  callEnvironment: (
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown>
  now: () => number
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT
}

function isCount(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0)
}

/** A server's answer is checked field by field; anything malformed is dropped, not trusted. */
export function parseForkClashReport(answer: unknown): ForkClashHostReport | null {
  if (typeof answer !== 'object' || answer === null) {
    return null
  }
  const { off, repos } = answer as { off?: unknown; repos?: unknown }
  if (off === true) {
    return { off: true, repos: [] }
  }
  if (!Array.isArray(repos)) {
    return null
  }
  const parsed: ForkClashRepo[] = []
  for (const raw of repos.slice(0, MAX_REPOS)) {
    const repo = raw as Partial<ForkClashRepo> | null
    if (!repo || !isText(repo.repoId) || !isText(repo.name) || !Array.isArray(repo.branches)) {
      continue
    }
    parsed.push({
      repoId: repo.repoId,
      name: repo.name,
      projectKey: isText(repo.projectKey) ? repo.projectKey : null,
      baseRef: isText(repo.baseRef) ? repo.baseRef : null,
      ...(isText(repo.incomplete) ? { incomplete: repo.incomplete } : {}),
      branches: repo.branches
        .slice(0, MAX_BRANCHES_PER_REPO)
        .filter(
          (b) =>
            b &&
            isText(b.worktreeId) &&
            isText(b.path) &&
            isText(b.branch) &&
            isText(b.head) &&
            isCount(b.ahead) &&
            isCount(b.behind) &&
            Array.isArray(b.files) &&
            b.files.every(isText)
        )
        .map((b) => ({
          worktreeId: b.worktreeId,
          path: b.path,
          branch: b.branch,
          head: b.head,
          ahead: b.ahead,
          behind: b.behind,
          files: b.files.slice(0, FORK_CLASHES_MAX_FILES_PER_BRANCH),
          filesTruncated:
            b.filesTruncated === true || b.files.length > FORK_CLASHES_MAX_FILES_PER_BRANCH
        }))
    })
  }
  return { repos: parsed }
}

async function askServer(
  deps: ForkClashFleetDeps,
  environment: { id: string; name: string },
  project: string | undefined
): Promise<ForkClashHostResult> {
  const result = (status: ForkClashHostResult['status'], repos: ForkClashRepo[] = []) => ({
    hostId: toRuntimeExecutionHostId(environment.id),
    hostName: environment.name,
    status,
    repos
  })
  try {
    const answer = await deps.callEnvironment(
      environment.id,
      'fork.clashes.local',
      project ? { project } : {},
      FORK_CLASHES_HOST_TIMEOUT_MS
    )
    const report = parseForkClashReport(answer)
    if (!report) {
      return result('unreachable')
    }
    return report.off ? result('off') : result('ok', report.repos)
  } catch (error) {
    return result(errorCode(error) === 'method_not_found' ? 'no-clashes' : 'unreachable')
  }
}

/** This machine and (when the setting allows) every paired server, folded into clashes. */
export async function gatherForkClashes(
  deps: ForkClashFleetDeps,
  project: string | undefined
): Promise<ForkClashResult> {
  const config = deps.config()
  const local: ForkClashHostResult = await deps.localReport(project).then(
    (report) => ({
      hostId: LOCAL_EXECUTION_HOST_ID,
      hostName: LOCAL_NAME,
      status: report.off ? 'off' : 'ok',
      repos: report.repos
    }),
    () => ({
      hostId: LOCAL_EXECUTION_HOST_ID,
      hostName: LOCAL_NAME,
      status: 'unreachable',
      repos: []
    })
  )
  const environments = config.pairedServers ? await deps.listEnvironments() : []
  const servers = await mapWithConcurrency(environments, HOST_CONCURRENCY, (environment) =>
    askServer(deps, environment, project)
  )
  return buildForkClashes([local, ...servers], config.behindThreshold, deps.now())
}
