// FORK.md "Custom ACP agents": the host's saved custom agents and where each keeps its own folder.
// The desktop app and orcad each install it once, beside the profiles (`mcp-profiles-host.ts`).
import { basename, join } from 'node:path'
import {
  isLegacyAgentSessionAccountHome,
  type AgentSessionAccountHome,
  type LegacyAgentSessionAccountHome
} from '../../../shared/agent-session/lifecycle/accounts/agent-session-account-home'
import {
  customAcpAgentNameProblem,
  normalizeForkCustomAcpAgents,
  type ForkCustomAcpAgent,
  type ForkCustomAcpAgentSettings
} from '../../../shared/fork/custom-acp-agents/custom-acp-agent-types'
import { loadForkCustomAcpEnvStore } from './custom-acp-agent-env-store'

export const FORK_CUSTOM_ACP_DATA_FOLDER = 'fork-custom-acp-agents'
/** Names the agent's own private folder in its environment; it pins which agent a chat runs. */
export const CUSTOM_ACP_HOME_VARIABLE = 'ORCA_CUSTOM_AGENT_HOME'
/** The folder name of a chat that picked no agent; it is no valid name, so such a chat never runs. */
export const CUSTOM_ACP_UNPINNED_FOLDER = '.none'

let readSettings: (() => ForkCustomAcpAgentSettings | undefined) | null = null
let dataFolder: string | null = null

/** Returns the env store's load, which a launch waits on rather than start without its values. */
export function installForkCustomAcpAgentsOnHost(input: {
  readSettings: () => ForkCustomAcpAgentSettings | undefined
  userDataPath: string
}): Promise<void> {
  readSettings = input.readSettings
  dataFolder = join(input.userDataPath, FORK_CUSTOM_ACP_DATA_FOLDER)
  return loadForkCustomAcpEnvStore(dataFolder)
}

export function forkCustomAcpAgentsInstalled(): boolean {
  return readSettings !== null && dataFolder !== null
}

export function forkCustomAcpAgents(): ForkCustomAcpAgent[] {
  return normalizeForkCustomAcpAgents(readSettings?.()?.forkCustomAcpAgents)
}

export function forkCustomAcpAgentNamed(name: string): ForkCustomAcpAgent | null {
  return forkCustomAcpAgents().find((agent) => agent.name === name) ?? null
}

function agentsFolder(root: string): string {
  return join(root, 'agents')
}

/** The account home a chat of `name` is pinned to: the agent's private folder on this host. */
export function forkCustomAcpAgentHome(name: string): LegacyAgentSessionAccountHome {
  if (!dataFolder) {
    throw new Error('Custom agents are not set up on this host.')
  }
  return { variable: CUSTOM_ACP_HOME_VARIABLE, path: join(agentsFolder(dataFolder), name) }
}

/** The pin of a chat that named no agent, under `stateDirectory` (the host's data folder). */
export function forkCustomAcpUnpinnedHome(stateDirectory: string): LegacyAgentSessionAccountHome {
  return {
    variable: CUSTOM_ACP_HOME_VARIABLE,
    path: join(
      agentsFolder(join(stateDirectory, FORK_CUSTOM_ACP_DATA_FOLDER)),
      CUSTOM_ACP_UNPINNED_FOLDER
    )
  }
}

/** Which custom agent `home` pins, or null for another agent's home or a chat that named none. */
export function forkCustomAcpAgentNameOfHome(home: AgentSessionAccountHome | null): string | null {
  if (!home || !isLegacyAgentSessionAccountHome(home)) {
    return null
  }
  const name = basename(home.path)
  return home.variable === CUSTOM_ACP_HOME_VARIABLE && customAcpAgentNameProblem(name) === null
    ? name
    : null
}

/** Test seam. */
export function resetForkCustomAcpAgentsHostForTests(): void {
  readSettings = null
  dataFolder = null
}
