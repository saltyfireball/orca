// FORK.md "MCP profiles": reads --mcp-profile for agent launches. A host without
// profiles drops the param, as it does any param it does not know.
import { FORK_MCP_PROFILE_PARAM, isForkMcpProfileName } from '../../shared/fork/mcp-profiles'
import { getOptionalStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'
import { FORK_MCP_PROFILE_FLAG } from './mcp-profile-specs'

export function readForkMcpProfileFlag(flags: Map<string, string | boolean>): {
  [FORK_MCP_PROFILE_PARAM]?: string
} {
  if (!flags.has(FORK_MCP_PROFILE_FLAG)) {
    return {}
  }
  const name = getOptionalStringFlag(flags, FORK_MCP_PROFILE_FLAG)?.trim()
  if (!name || !isForkMcpProfileName(name)) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--mcp-profile takes a profile name (letters, digits, dot, dash or underscore).'
    )
  }
  return { [FORK_MCP_PROFILE_PARAM]: name }
}
