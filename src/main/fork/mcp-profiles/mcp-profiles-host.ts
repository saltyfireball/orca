// FORK.md "MCP profiles", "Agent profiles" (BAD-800) and "Custom ACP agents" (BAD-873): what a
// host that runs agents loads so a `--profile`, `--mcp-profile` or custom agent start applies
// there. The desktop app (`mcp-profiles-ipc.ts`) and orcad (`headless-host.ts`) each call it once
// with their own settings and user data folder, which that host's own instance lock holds, so two
// hosts never share the folder. No electron here.
import { join } from 'node:path'
import type { ForkMcpProfileSettings } from '../../../shared/fork/mcp-profiles'
import type { ForkAgentProfileHostSettings } from '../agent-profiles/agent-profile-account'
import { installForkAgentProfileLaunch } from '../agent-profiles/agent-profile-launch-scope'
import { installForkMcpProfiles, shutdownForkMcpProfiles } from './mcp-profiles-service'
import type { ForkCustomAcpAgentSettings } from '../../../shared/fork/custom-acp-agents/custom-acp-agent-types'
import { installForkCustomAcpAgentsOnHost } from '../custom-acp-agents/custom-acp-agents-host'

export const FORK_MCP_DATA_FOLDER = 'fork-mcp-profiles'

export type ForkProfilesHostSettings = ForkMcpProfileSettings &
  ForkAgentProfileHostSettings &
  ForkCustomAcpAgentSettings

/** Returns the load (chat state read, old launch files swept) and the quit step. */
export function installForkProfilesOnHost(input: {
  readSettings: () => ForkProfilesHostSettings | undefined
  userDataPath: string
}): { ready: Promise<void>; shutdown: () => Promise<void> } {
  installForkAgentProfileLaunch({ readSettings: input.readSettings })
  const ready = installForkMcpProfiles({
    readSettings: input.readSettings,
    dataFolder: join(input.userDataPath, FORK_MCP_DATA_FOLDER)
  }).catch((error: unknown) => console.warn('[fork-mcp-profiles] start-up failed', String(error)))
  // BAD-873 (FORK.md "Custom ACP agents"): their definitions and private env store.
  const customAgents = installForkCustomAcpAgentsOnHost(input).catch((error: unknown) =>
    console.warn('[fork-custom-acp-agents] start-up failed', String(error))
  )
  return {
    ready: Promise.all([ready, customAgents]).then(() => undefined),
    shutdown: () =>
      shutdownForkMcpProfiles().catch((error: unknown) =>
        console.warn('[fork-mcp-profiles] shutdown failed', String(error))
      )
  }
}
