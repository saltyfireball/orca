// FORK.md "Custom ACP agents": a new `custom-acp` chat names its agent in the create option
// `customAcpAgent`. The host takes it out of the options (it is no setting of the agent's) and pins
// the chat's account home to that agent, which keeps the chat on it for every later start.
import {
  AgentSessionRefusalError,
  refuse
} from '../../../shared/agent-session/failures/agent-session-wire-refusals'
import type { AgentSessionAccountHome } from '../../../shared/agent-session/lifecycle/accounts/agent-session-account-home'
import {
  CUSTOM_ACP_AGENT,
  CUSTOM_ACP_AGENT_OPTION_ID
} from '../../../shared/fork/custom-acp-agents/custom-acp-agent-types'
import {
  forkCustomAcpAgentHome,
  forkCustomAcpAgentNamed,
  forkCustomAcpAgentsInstalled
} from './custom-acp-agents-host'

type CreateArgs = {
  agent: string
  options?: Readonly<Record<string, string>>
  forkFrom?: unknown
  resumeFrom?: unknown
}

type CustomCreate = {
  /** The create's options without the agent's name. */
  options: Readonly<Record<string, string>> | undefined
  pin: <R extends { accountHome: AgentSessionAccountHome }>(resolved: R) => R
}

/** The cause a custom chat's refusal carries, so the create's refusal keeps saying why. */
class ForkCustomAcpCreateRefusal extends Error {}

function refused(message: string): AgentSessionRefusalError {
  return new AgentSessionRefusalError(
    refuse('agent_session_operation_invalid', { reason: 'optionRejected' }, message),
    { cause: new ForkCustomAcpCreateRefusal(message) }
  )
}

/** The reason of a custom chat's create refusal, for the create's pre-commit refusal to keep. */
export function forkCustomAcpRefusalMessage(error: AgentSessionRefusalError): string | null {
  return error.cause instanceof ForkCustomAcpCreateRefusal ? error.cause.message : null
}

function withoutOption(
  options: Readonly<Record<string, string>> | undefined
): Readonly<Record<string, string>> | undefined {
  if (!options || !(CUSTOM_ACP_AGENT_OPTION_ID in options)) {
    return options
  }
  const { [CUSTOM_ACP_AGENT_OPTION_ID]: _name, ...rest } = options
  return Object.keys(rest).length > 0 ? rest : undefined
}

/** The options without the agent's name, and the pin to put on the resolved create. A fork or
 *  adoption keeps its source's pin. Throws a refusal when a new custom chat names no saved agent. */
export function forkCustomAcpCreate(args: CreateArgs): CustomCreate {
  const keep = <R>(resolved: R): R => resolved
  if (args.agent !== CUSTOM_ACP_AGENT) {
    return { options: args.options, pin: keep }
  }
  const name = args.options?.[CUSTOM_ACP_AGENT_OPTION_ID]
  const options = withoutOption(args.options)
  if (args.forkFrom || args.resumeFrom) {
    return { options, pin: keep }
  }
  if (!forkCustomAcpAgentsInstalled()) {
    throw refused('Custom ACP agents are not set up on this host.')
  }
  if (!name) {
    throw refused(
      'A custom ACP chat needs the name of a saved agent (orca agent custom list shows them).'
    )
  }
  if (!forkCustomAcpAgentNamed(name)) {
    throw refused(`No custom agent named ${name} is saved on this host (orca agent custom list).`)
  }
  const home = forkCustomAcpAgentHome(name)
  return { options, pin: (resolved) => ({ ...resolved, accountHome: home }) }
}
