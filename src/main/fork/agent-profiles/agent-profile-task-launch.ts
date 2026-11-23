// FORK.md "Agent profiles" (BAD-741): wraps upstream's two startWorker calls. A start that names no
// profile of its own but continues a Task first started under one (an automatic retry, a follow-up,
// `--retry-of`, `--task`) runs in that profile's launch scope again: the same agent, mode, account
// and MCP profile, checked against this host as it is now. A refusal stops the start before
// anything is created, and an automatic retry reports it (`orca retry show`, the coordinator).
import { InvalidArgumentError } from '../../runtime/rpc/core'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import {
  assertForkMcpProfileApplies,
  assertForkMcpProfileKnown,
  assertForkMcpProfileNotForExistingTerminal,
  currentForkMcpLaunchScope,
  runInForkMcpLaunchScope
} from '../mcp-profiles/mcp-launch-scope'
import {
  currentForkAgentProfileLaunch,
  forkAgentProfileLaunchOfTask,
  runInForkAgentProfileLaunch
} from './agent-profile-launch-scope'
import { forkContinuedTaskId, forkReadTaskLaunch } from './agent-profile-task-store'

type StartParams = {
  task?: string
  retryOf?: string
  agent?: string
  on?: string
  terminal?: string
}

/** The hook: `startWorker` run through `forkWithTaskProfileLaunch`. */
export function forkTaskProfileStart<
  P extends StartParams,
  C extends { runtime: { getOrchestrationDb: () => OrchestrationDb } },
  F extends { of: string },
  R
>(start: (params: P, ctx: C, followUp?: F) => Promise<R>) {
  return (params: P, ctx: C, followUp?: F): Promise<R> =>
    forkWithTaskProfileLaunch(ctx.runtime.getOrchestrationDb(), params, followUp?.of, () =>
      start(params, ctx, followUp)
    )
}

export function forkWithTaskProfileLaunch<T>(
  db: OrchestrationDb,
  params: StartParams,
  followUpOf: string | undefined,
  run: () => T
): T {
  if (currentForkAgentProfileLaunch()) {
    // The start's own --profile wins.
    return run()
  }
  const taskId = forkContinuedTaskId(db, params.task, followUpOf ?? params.retryOf)
  const stored = taskId ? forkReadTaskLaunch(db, taskId) : null
  if (!stored) {
    return run()
  }
  let next = run
  const mcpProfile = stored.mcpProfile
  if (mcpProfile && !currentForkMcpLaunchScope()?.profile) {
    assertForkMcpProfileNotForExistingTerminal(mcpProfile, params.terminal)
    // A start placed on a paired server is checked against that server's profiles.
    if (!params.on) {
      assertForkMcpProfileKnown(
        mcpProfile,
        `This Task's worker was first started with MCP profile "${mcpProfile}", which this computer no longer has: `
      )
    }
    assertForkMcpProfileApplies(mcpProfile, { agent: params.agent })
    next = () => runInForkMcpLaunchScope({ kind: 'worker', profile: mcpProfile }, run)
  }
  const launch = forkAgentProfileLaunchOfTask(stored, params.agent, Boolean(params.on))
  if (
    launch &&
    params.terminal &&
    (launch.permissionMode || launch.account || launch.carry?.account)
  ) {
    throw new InvalidArgumentError(
      `This Task's profile "${launch.name}" sets a permission mode or account, which a worker reusing --terminal cannot take: that agent is already running. Start a new worker instead. Nothing was started.`
    )
  }
  return launch ? runInForkAgentProfileLaunch(launch, next) : next()
}
