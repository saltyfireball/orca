// Batch start (FORK.md, SLRM-2395): one prompt becomes a worktree plus agent per model, on the
// machine auto placement picks (or this one). Each start goes through agent.launch, so the launch
// queue gates it; the answer names the machine and each task's queue place. Dependencies are
// injected so the flow is tested without a runtime.
import type { TuiAgent } from '../../../shared/agent-launch/catalog/tui-agent'
import type { ForkPlacementPickResult } from '../../../shared/fork/auto-placement-wire'
import { describeForkPlacementCandidate } from '../../../shared/fork/auto-placement'
import {
  forkBatchDisplayName,
  forkBatchWorktreeName,
  type ForkBatchStartRequest,
  type ForkBatchStartResult,
  type ForkBatchStartTask
} from '../../../shared/fork/batch-start'

const RUNTIME_PREFIX = 'runtime:'

/** The agent.launch request for one task, before the host's own schema parses it. */
export type ForkBatchLaunchRequest = {
  agent: TuiAgent
  target: {
    kind: 'create-worktree'
    create: {
      repo: string
      repoHostId?: string
      name: string
      displayName: string
      displayNameKind: 'user'
    }
  }
  prompt: { text: string; delivery: 'submit' }
  presentation: 'background'
  launchSource: string
}

export type ForkBatchLaunchAnswer = {
  worktreeId: string
  outcome: { kind: string; sessionId?: string }
  warning?: string
}

export type ForkBatchStartDeps = {
  /** Ranks this machine and its paired servers for the project. */
  pick: (hosts: string[], project: string) => Promise<ForkPlacementPickResult>
  /** Machines this one keeps a ready setup of the project for. */
  readySetupHosts: (projectId: string) => string[]
  /** The project's repo selector on this machine, or null when it has no ready setup here. */
  localRepo: (project: { id: string; name?: string }) => string | null
  /** This machine's display name. */
  localLabel: () => string
  launch: (request: ForkBatchLaunchRequest) => Promise<ForkBatchLaunchAnswer>
  /** The launch's place in this machine's agent queue, or null when it is not waiting. */
  queuePosition: (sessionId: string) => Promise<number | null>
  /** Sends the batch to a paired server, to run there as `placement: 'here'`. */
  forward: (environmentId: string, request: ForkBatchStartRequest) => Promise<ForkBatchStartResult>
  /** A short random tail for worktree names. */
  randomTail: () => string
}

export const FORK_BATCH_LAUNCH_SOURCE = 'fork-batch-start'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function startOne(
  deps: ForkBatchStartDeps,
  request: ForkBatchStartRequest,
  repo: { repo: string; repoHostId?: string },
  agent: TuiAgent
): Promise<ForkBatchStartTask> {
  const name = forkBatchWorktreeName(request.prompt, agent, deps.randomTail())
  try {
    const answer = await deps.launch({
      agent,
      target: {
        kind: 'create-worktree',
        create: {
          ...repo,
          name,
          displayName: forkBatchDisplayName(request.prompt) || name,
          displayNameKind: 'user'
        }
      },
      prompt: { text: request.prompt, delivery: 'submit' },
      presentation: 'background',
      launchSource: FORK_BATCH_LAUNCH_SOURCE
    })
    const sessionId = answer.outcome.kind === 'structured' ? answer.outcome.sessionId : undefined
    const position = sessionId ? await deps.queuePosition(sessionId).catch(() => null) : null
    return {
      agent,
      ok: true,
      worktreeId: answer.worktreeId,
      name,
      ...(position ? { queuedPosition: position } : {}),
      ...(answer.warning ? { warning: answer.warning } : {})
    }
  } catch (error) {
    return { agent, ok: false, error: messageOf(error) }
  }
}

/** Starts every model on this machine, one after another so the queue keeps their order. */
async function runHere(
  deps: ForkBatchStartDeps,
  request: ForkBatchStartRequest
): Promise<ForkBatchStartResult> {
  const repoSelector =
    request.repo ?? (request.project ? deps.localRepo(request.project) : null) ?? null
  if (!repoSelector) {
    throw new Error(`The project has no ready setup on ${deps.localLabel()}.`)
  }
  const repo = {
    repo: repoSelector,
    ...(request.repo && request.repoHostId ? { repoHostId: request.repoHostId } : {})
  }
  const tasks: ForkBatchStartTask[] = []
  for (const agent of new Set(request.agents)) {
    tasks.push(await startOne(deps, request, repo, agent))
  }
  return { hostKey: 'local', hostLabel: deps.localLabel(), tasks }
}

export async function runForkBatchStart(
  deps: ForkBatchStartDeps,
  request: ForkBatchStartRequest
): Promise<ForkBatchStartResult> {
  if (request.placement === 'here' || !request.project) {
    return runHere(deps, request)
  }
  const project = request.project
  const pick = await deps.pick(deps.readySetupHosts(project.id), project.id)
  if (pick.off || !pick.picked) {
    const why = pick.off ? [] : pick.ranked.map(describeForkPlacementCandidate)
    throw new Error(['No machine can take this project now.', ...why].filter(Boolean).join('\n'))
  }
  const picked = pick.picked
  if (!picked.hostKey.startsWith(RUNTIME_PREFIX)) {
    return runHere(deps, { ...request, repo: undefined, repoHostId: undefined })
  }
  const environmentId = picked.hostKey.slice(RUNTIME_PREFIX.length)
  // The server resolves the project against its own setups; a repo id from here means nothing there.
  const forwarded = await deps
    .forward(environmentId, {
      project,
      prompt: request.prompt,
      agents: request.agents,
      placement: 'here'
    })
    .catch((error: unknown) => {
      const code = (error as { code?: unknown } | null)?.code
      throw new Error(
        code === 'method_not_found'
          ? `${picked.name} runs a Blackfish without batch start. Update it, or turn Auto machine off.`
          : `${picked.name}: ${messageOf(error)}`
      )
    })
  return { ...forwarded, hostKey: picked.hostKey, hostLabel: picked.name }
}
