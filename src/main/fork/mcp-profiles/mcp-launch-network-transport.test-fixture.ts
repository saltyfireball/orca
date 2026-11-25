// The methods the BAD-800 transport test serves: the real status, repo, automation and agent
// profile methods, and stand-ins for agent.launch, worktree.create and orchestration.workerStart
// that build the real Claude terminal plan inside whatever launch scope they run in.
import { z } from 'zod'
import {
  defineMethod,
  InvalidArgumentError,
  type RpcAnyMethodDeclaration,
  type RpcContext
} from '../../runtime/rpc/core'
import { defineOrchestrationMethod } from '../../runtime/rpc/methods/orchestration/access/orchestration-method-access'
import { STATUS_METHODS } from '../../runtime/rpc/methods/host-management/status'
import { REPO_METHODS } from '../../runtime/rpc/methods/projects/repo'
import { AUTOMATION_METHODS } from '../../runtime/rpc/methods/automations/automations'
import { FORK_AGENT_PROFILE_METHODS } from '../../runtime/rpc/methods/fork/fork-agent-profiles'

/** The terminal commands the stand-in launches built, in order. */
export const standInLaunches: string[] = []

const AnyParams = z.record(z.string(), z.unknown())

function standInLaunch(name: string): RpcAnyMethodDeclaration {
  const spec = { name, permission: 'workspace' as const, params: AnyParams, handler: launch }
  return name.startsWith('orchestration.')
    ? defineOrchestrationMethod({
        ...spec,
        name: name as `orchestration.${string}`,
        access: { kind: 'writes', targets: {} }
      })
    : defineMethod(spec)
}

async function launch(
  _params: unknown,
  { runtime, orchestrationMutation }: RpcContext
): Promise<{ launched: true }> {
  const repo = runtime.requireStore().getRepos()[0]
  if (!repo) {
    throw new InvalidArgumentError('stand-in: no repo')
  }
  const plan = await runtime.resolveAgentTerminalCreateOptions(
    {
      id: `${repo.id}::wt-1`,
      path: repo.path,
      connectionId: null,
      repo: null,
      folderWorkspace: null
    },
    {
      startupAgent: 'claude',
      launchRuntime: {
        platform: 'darwin',
        pty: { shellOverride: undefined, terminalWindowsWslDistro: null }
      }
    }
  )
  standInLaunches.push(plan.command ?? '')
  if (orchestrationMutation) {
    // A worker start records its receipt when it accepts the start, as the real one does.
    runtime.getOrchestrationDb().beginMutationReceipt(orchestrationMutation)
  }
  return { launched: true }
}

export const TEST_METHODS: readonly RpcAnyMethodDeclaration[] = [
  ...STATUS_METHODS,
  ...REPO_METHODS,
  ...AUTOMATION_METHODS,
  ...FORK_AGENT_PROFILE_METHODS,
  ...['agent.launch', 'worktree.create', 'orchestration.workerStart'].map(standInLaunch)
]
