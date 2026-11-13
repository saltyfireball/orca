// SLRM-2099: refuse a new agent tab while the opt-in memory pause is on and memory is over the
// threshold. Refuses through upstream's own path, so the caller's surface or toast shows why.
import { notifyAgentLaunchFailure } from '@/lib/agent-session/launch/failure/agent-launch-failure'
import { refuseAgentTabLaunch } from '@/lib/agent-session/launch/new-tab/launch-agent-tab-refusal'
import type { LaunchAgentInNewTabArgs } from '@/lib/agent-session/launch/new-tab/launch-agent-in-new-tab-args'
import type { AgentTabLaunchOutcome } from '@/lib/agent-session/launch/new-tab/launch-agent-in-new-tab-host-agents'
import { forkMemoryLaunchRefusal } from './memory-status'

/** The refused outcome, or null when the launch may go ahead. */
export function forkRefuseAgentLaunchOverMemory(
  args: LaunchAgentInNewTabArgs,
  notifyFailure: boolean
): AgentTabLaunchOutcome | null {
  const message = forkMemoryLaunchRefusal()
  if (!message) {
    return null
  }
  return refuseAgentTabLaunch(
    args,
    message,
    () => notifyAgentLaunchFailure(args.agent, message),
    notifyFailure
  )
}
