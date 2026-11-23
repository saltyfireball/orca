// FORK.md "Agent profiles" (BAD-741): a `--profile` start placed on a paired server (`--on`). The
// home resolved the profile; its permission mode, account and preamble travel in the start, and the
// server checks them against its own settings and accounts. A server too old to read them would
// start the worker on its own permission and account, so it is refused before anything is created.
// The MCP profile (`--mcp-profile`, or a profile's) travels by name only: the server's own profile
// of that name decides what loads, and the home asks the server for its names before anything is
// created, so an unknown name refuses with no effects.
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import {
  FORK_AGENT_PROFILE_LAUNCH_PARAM,
  type ForkAgentProfileLaunchWire
} from '../../../shared/fork/agent-profiles/agent-profile-launch'
import {
  ORCHESTRATION_FORK_AGENT_PROFILE_LAUNCH_RUNTIME_CAPABILITY,
  ORCHESTRATION_FORK_MCP_PROFILE_LAUNCH_RUNTIME_CAPABILITY
} from '../../../shared/orchestration/orchestration-runtime-capabilities'
import {
  FORK_MCP_PROFILE_ALL,
  FORK_MCP_PROFILE_PARAM,
  forkMcpProfileExists,
  type ForkMcpProfile
} from '../../../shared/fork/mcp-profiles'
import { currentForkMcpLaunchScope } from '../mcp-profiles/mcp-launch-scope'
import { currentForkAgentProfileLaunch } from './agent-profile-launch-scope'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { OrchestrationWorkerServer } from '../../runtime/orchestration/federation/environment-transport'
import { getOrchestrationPeerCapabilityCache } from '../../runtime/orchestration/federation/orchestration-peer-capability-cache'
import { ORCHESTRATION_CONTRACT_PREFLIGHT_TIMEOUT_MS } from '../../../shared/orchestration/orchestration-timing-budgets'
import type { RuntimeStatus } from '../../../shared/remote-runtime/session-graph/runtime-session-contracts'

export type ForkAgentProfileCarry = {
  [FORK_AGENT_PROFILE_LAUNCH_PARAM]?: ForkAgentProfileLaunchWire
  [FORK_MCP_PROFILE_PARAM]?: string
}

function carriedProfile(): ForkAgentProfileLaunchWire | undefined {
  const carry = currentForkAgentProfileLaunch()?.carry
  return carry && (carry.permissionMode || carry.account || carry.preamble) ? carry : undefined
}

/** The MCP profile this start names, unless it is the stock "all". */
function carriedMcpProfile(): string | undefined {
  const profile = currentForkMcpLaunchScope()?.profile
  return profile && profile !== FORK_MCP_PROFILE_ALL ? profile : undefined
}

const noEffects = { effectsApplied: false }

function refuseMcp(serverName: string, profile: string, why: string): never {
  throw new OrchestrationError(
    'capability_unsupported',
    `Connected server ${serverName} ${why}, so MCP profile "${profile}" cannot apply there. Update it, start the worker here, or start it without the MCP profile. No effects were applied.`,
    noEffects
  )
}

/** The start's request field for the server; refuses a server that cannot honor it. */
export function forkAgentProfileServerCarry(
  serverName: string,
  capabilities: readonly string[] | undefined
): ForkAgentProfileCarry {
  const mcp = carriedMcpProfile()
  if (mcp) {
    // Only a server that owns its workers takes one; this attach-start is an older server's.
    refuseMcp(serverName, mcp, 'is too old to apply an MCP profile')
  }
  return profileCarry(serverName, capabilities)
}

function profileCarry(
  serverName: string,
  capabilities: readonly string[] | undefined
): ForkAgentProfileCarry {
  const carry = carriedProfile()
  if (!carry) {
    return {}
  }
  if (!capabilities?.includes(ORCHESTRATION_FORK_AGENT_PROFILE_LAUNCH_RUNTIME_CAPABILITY)) {
    throw new OrchestrationError(
      'capability_unsupported',
      `Connected server ${serverName} cannot apply profile "${carry.name}"'s permission mode, account or preamble (it needs the same Blackfish version as this computer). Update it, start the worker here, or use a profile without them. No effects were applied.`,
      noEffects
    )
  }
  return { [FORK_AGENT_PROFILE_LAUNCH_PARAM]: carry }
}

async function serverSupports(
  runtime: OrcaRuntimeService,
  server: OrchestrationWorkerServer,
  capability: string
): Promise<boolean> {
  const decision = await getOrchestrationPeerCapabilityCache(runtime).resolve({
    peerFingerprint: server.peerFingerprint,
    expectedRuntimeEpoch: null,
    capability,
    probe: async () =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: status.get answers RuntimeStatus; the cache reads only its capabilities and runtime ID.
      (await runtime.callOrchestrationWorkerServer(
        server.environmentId,
        'status.get',
        undefined,
        ORCHESTRATION_CONTRACT_PREFLIGHT_TIMEOUT_MS,
        undefined,
        { expectedEnvironmentPairingRevision: server.pairingRevision }
      )) as RuntimeStatus
  })
  return decision.supported
}

/** Refuses an MCP profile the server lacks or cannot apply, before anything is created. */
async function checkServerMcpProfile(
  runtime: OrcaRuntimeService,
  server: OrchestrationWorkerServer,
  profile: string
): Promise<void> {
  if (
    !(await serverSupports(
      runtime,
      server,
      ORCHESTRATION_FORK_MCP_PROFILE_LAUNCH_RUNTIME_CAPABILITY
    ))
  ) {
    refuseMcp(server.name, profile, 'is too old to apply an MCP profile')
  }
  const listing: unknown = await runtime.callOrchestrationWorkerServer(
    server.environmentId,
    'fork.mcpProfiles.list',
    {},
    ORCHESTRATION_CONTRACT_PREFLIGHT_TIMEOUT_MS,
    undefined,
    { expectedEnvironmentPairingRevision: server.pairingRevision }
  )
  const listed =
    listing &&
    typeof listing === 'object' &&
    'profiles' in listing &&
    Array.isArray(listing.profiles)
      ? listing.profiles
      : []
  // Only the names matter here; the server's own definitions decide what loads.
  const profiles: ForkMcpProfile[] = listed.flatMap((entry: unknown) =>
    entry && typeof entry === 'object' && 'name' in entry && typeof entry.name === 'string'
      ? [{ name: entry.name, mode: 'allow' as const, servers: [] }]
      : []
  )
  if (!forkMcpProfileExists(profiles, profile)) {
    refuseMcp(
      server.name,
      profile,
      `has no MCP profile named "${profile}" (see its \`orca mcp-profile list\`)`
    )
  }
}

/** The same for a server that owns the workers placed on it: its capability is read only when
 *  there is something to carry. */
export async function forkAgentProfileRemoteOwnedCarry(
  runtime: OrcaRuntimeService,
  server: OrchestrationWorkerServer
): Promise<ForkAgentProfileCarry> {
  const mcp = carriedMcpProfile()
  if (mcp) {
    await checkServerMcpProfile(runtime, server, mcp)
  }
  const mcpCarry = mcp ? { [FORK_MCP_PROFILE_PARAM]: mcp } : {}
  if (!carriedProfile()) {
    return mcpCarry
  }
  const supported = await serverSupports(
    runtime,
    server,
    ORCHESTRATION_FORK_AGENT_PROFILE_LAUNCH_RUNTIME_CAPABILITY
  )
  return {
    ...profileCarry(
      server.name,
      supported ? [ORCHESTRATION_FORK_AGENT_PROFILE_LAUNCH_RUNTIME_CAPABILITY] : []
    ),
    ...mcpCarry
  }
}
