// FORK.md "MCP profiles": reads --mcp-profile for agent launches. A host without
// profiles drops the param, as it does any param it does not know.
import { FORK_MCP_PROFILE_PARAM, isForkMcpProfileName } from '../../shared/fork/mcp-profiles'
import { getOptionalStringFlag } from '../arguments/flags'
import { RuntimeClientError } from '../runtime/connection/types'
import { FORK_MCP_PROFILE_FLAG } from './mcp-profile-specs'
import { FORK_AGENT_PROFILE_PARAM } from '../../shared/fork/agent-profiles/agent-profiles-types'
import { FORK_AGENT_PROFILE_FLAG } from './agent-profile-specs'

/** BAD-741: the profile name rides along so the host applies its permission mode, account and
 *  preamble itself (FORK.md "Agent profiles"); `applyForkAgentProfile` has checked it. */
function readForkAgentProfileParam(flags: Map<string, string | boolean>): {
  [FORK_AGENT_PROFILE_PARAM]?: string
} {
  const name = getOptionalStringFlag(flags, FORK_AGENT_PROFILE_FLAG)?.trim()
  return name ? { [FORK_AGENT_PROFILE_PARAM]: name } : {}
}

export function readForkMcpProfileFlag(flags: Map<string, string | boolean>): {
  [FORK_MCP_PROFILE_PARAM]?: string
  [FORK_AGENT_PROFILE_PARAM]?: string
} {
  if (!flags.has(FORK_MCP_PROFILE_FLAG)) {
    return readForkAgentProfileParam(flags)
  }
  const name = getOptionalStringFlag(flags, FORK_MCP_PROFILE_FLAG)?.trim()
  if (!name || !isForkMcpProfileName(name)) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--mcp-profile takes a profile name (letters, digits, dot, dash or underscore).'
    )
  }
  return { [FORK_MCP_PROFILE_PARAM]: name, ...readForkAgentProfileParam(flags) }
}
