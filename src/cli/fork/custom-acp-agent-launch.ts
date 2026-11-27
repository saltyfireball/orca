// BAD-873 (FORK.md "Custom ACP agents"): `orca agent launch --agent <custom name>` starts a chat
// on the saved agent; the hook in agent-launch.ts hands it here before the TUI agent check.
import type { HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  getRequiredWorktreeSelector,
  resolveCurrentWorktreeSelector
} from '../workspace-selection/workspace-selector'
import { isTuiAgent } from '../../shared/agent-launch/catalog/tui-agent-config'
import {
  CUSTOM_ACP_AGENT,
  customAcpAgentNameProblem
} from '../../shared/fork/custom-acp-agents/custom-acp-agent-types'
import type {
  ForkCustomAcpAgentsListResult,
  ForkCustomAcpAgentStartChatResult
} from '../../shared/fork/custom-acp-agents/custom-acp-agents-wire'

type LaunchContext = Pick<HandlerContext, 'flags' | 'client' | 'cwd' | 'json'>

async function savedOnHost(ctx: LaunchContext, name: string): Promise<boolean> {
  const listed = await ctx.client
    .call<ForkCustomAcpAgentsListResult>('fork.customAcpAgents.list', {})
    .catch(() => null)
  return listed?.result.agents.some((agent) => agent.name === name) === true
}

/** Why a flag the agent cannot honor is refused, rather than dropped without a word. */
function unsupportedFlag(flags: LaunchContext['flags']): string | null {
  if (flags.has('model') || flags.has('effort')) {
    return 'which picks its own model; leave out --model and --effort.'
  }
  if (flags.get('surface') === 'terminal') {
    return 'which runs as a chat only; leave out --surface terminal.'
  }
  if (flags.has('profile')) {
    return 'which runs as saved, so agent profiles do not apply; leave out --profile.'
  }
  if (flags.has('mcp-profile')) {
    return 'so Orca MCP profiles do not apply to it; leave out --mcp-profile.'
  }
  if (flags.has('retry-launch')) {
    return 'whose chat start has no launch retry; find the chat with orca agent list, or launch again.'
  }
  return null
}

/** True when `--agent` named a custom agent and its chat was started; false leaves the launch to
 *  the TUI agent path, which names an unknown agent itself. */
export async function launchForkCustomAcpAgent(ctx: LaunchContext): Promise<boolean> {
  const name = getOptionalStringFlag(ctx.flags, 'agent')
  if (!name || isTuiAgent(name) || customAcpAgentNameProblem(name) !== null) {
    return false
  }
  if (!(await savedOnHost(ctx, name))) {
    return false
  }
  const { flags, client, cwd } = ctx
  const refusal = unsupportedFlag(flags)
  if (refusal) {
    throw new RuntimeClientError('invalid_argument', `${name} is a custom ACP agent, ${refusal}`)
  }
  if (client.isRemote && !flags.has('worktree')) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Remote agent launch requires --worktree because the client cwd cannot identify a server worktree.'
    )
  }
  const selector = flags.get('worktree')
  const current = selector === undefined || selector === 'active' || selector === 'current'
  const worktree = current
    ? await resolveCurrentWorktreeSelector(cwd, client, { agent: CUSTOM_ACP_AGENT })
    : await getRequiredWorktreeSelector(flags, 'worktree', cwd, client)
  const prompt = getOptionalStringFlag(flags, 'prompt')
  const started = await client.call<ForkCustomAcpAgentStartChatResult>(
    'fork.customAcpAgents.startChat',
    { name, worktree, ...(prompt ? { prompt } : {}), focus: flags.get('focus') === true }
  )
  printResult(started, ctx.json, (result) => `Started a ${name} chat: ${result.sessionId}`)
  return true
}
