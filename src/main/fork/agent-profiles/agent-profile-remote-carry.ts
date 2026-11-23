// FORK.md "Agent profiles" (BAD-741): a `--profile` start placed on a paired server (`--on`). The
// home resolved the profile; its permission mode, account and preamble travel in the start, and the
// server checks them against its own settings and accounts. A server too old to read them would
// start the worker on its own permission and account, so it is refused before anything is created.
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import {
  FORK_AGENT_PROFILE_LAUNCH_PARAM,
  type ForkAgentProfileLaunchWire
} from '../../../shared/fork/agent-profiles/agent-profile-launch'
import { ORCHESTRATION_FORK_AGENT_PROFILE_LAUNCH_RUNTIME_CAPABILITY } from '../../../shared/orchestration/orchestration-runtime-capabilities'
import { currentForkAgentProfileLaunch } from './agent-profile-launch-scope'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { OrchestrationWorkerServer } from '../../runtime/orchestration/federation/environment-transport'
import { getOrchestrationPeerCapabilityCache } from '../../runtime/orchestration/federation/orchestration-peer-capability-cache'
import { ORCHESTRATION_CONTRACT_PREFLIGHT_TIMEOUT_MS } from '../../../shared/orchestration/orchestration-timing-budgets'
import type { RuntimeStatus } from '../../../shared/remote-runtime/session-graph/runtime-session-contracts'

export type ForkAgentProfileCarry = {
  [FORK_AGENT_PROFILE_LAUNCH_PARAM]?: ForkAgentProfileLaunchWire
}

/** The start's request field for the server; refuses a server that cannot honor it. */
export function forkAgentProfileServerCarry(
  serverName: string,
  capabilities: readonly string[] | undefined
): ForkAgentProfileCarry {
  const carry = currentForkAgentProfileLaunch()?.carry
  if (!carry || (!carry.permissionMode && !carry.account && !carry.preamble)) {
    return {}
  }
  if (!capabilities?.includes(ORCHESTRATION_FORK_AGENT_PROFILE_LAUNCH_RUNTIME_CAPABILITY)) {
    throw new OrchestrationError(
      'capability_unsupported',
      `Connected server ${serverName} cannot apply profile "${carry.name}"'s permission mode, account or preamble (it needs the same Blackfish version as this computer). Update it, start the worker here, or use a profile without them. No effects were applied.`,
      { effectsApplied: false }
    )
  }
  return { [FORK_AGENT_PROFILE_LAUNCH_PARAM]: carry }
}

/** The same for a server that owns the workers placed on it: its capability is read only when
 *  there is something to carry. */
export async function forkAgentProfileRemoteOwnedCarry(
  runtime: OrcaRuntimeService,
  server: OrchestrationWorkerServer
): Promise<ForkAgentProfileCarry> {
  const carry = currentForkAgentProfileLaunch()?.carry
  if (!carry || (!carry.permissionMode && !carry.account && !carry.preamble)) {
    return {}
  }
  const decision = await getOrchestrationPeerCapabilityCache(runtime).resolve({
    peerFingerprint: server.peerFingerprint,
    expectedRuntimeEpoch: null,
    capability: ORCHESTRATION_FORK_AGENT_PROFILE_LAUNCH_RUNTIME_CAPABILITY,
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
  return forkAgentProfileServerCarry(
    server.name,
    decision.supported ? [ORCHESTRATION_FORK_AGENT_PROFILE_LAUNCH_RUNTIME_CAPABILITY] : []
  )
}
