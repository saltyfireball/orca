// FORK.md "Custom ACP agents": the one chat agent `custom-acp`, and the spec each chat launches,
// which its pinned account home picks: the saved program, its arguments, folder and environment.
import { chmod, mkdir } from 'node:fs/promises'
import { z } from 'zod'
import { lazyZodSchema } from '../../../shared/schema/lazy-zod-schema'
import type { AcpLaunchSpec } from '../../acp/launch/acp-launch-contract'
import type { AcpAccountBinding } from '../../acp/launch/acp-account-binding'
import type { AcpInstructionsDelivery } from '../../acp/launch/acp-instructions'
import type { Implementation, InitializeResponse } from '../../acp/generated/acp-protocol.generated'
import type { StructuredAgentSessionHistory } from '../../native-chat/conversation-adoption/structured-agent-cli-conversations'
import { ORCA_ACP_CLIENT_INFO } from '../../acp/launch/acp-client-info'
import {
  providerDiagnostic,
  withProviderDiagnostic
} from '../../../shared/agent-session/failures/agent-session-failure'
import {
  isLegacyAgentSessionAccountHome,
  type AgentSessionAccountHome
} from '../../../shared/agent-session/lifecycle/accounts/agent-session-account-home'
import {
  CUSTOM_ACP_AGENT,
  type ForkCustomAcpAgent
} from '../../../shared/fork/custom-acp-agents/custom-acp-agent-types'
import {
  CUSTOM_ACP_HOME_VARIABLE,
  forkCustomAcpAgentNamed,
  forkCustomAcpAgentNameOfHome,
  forkCustomAcpUnpinnedHome
} from './custom-acp-agents-host'
import {
  forkCustomAcpAgentEnvValues,
  forkCustomAcpEnvStoreLoaded
} from './custom-acp-agent-env-store'

/** Never run: a chat runs its agent's own command, and one with none refuses before spawning. */
const UNPINNED_COMMAND = 'orca-custom-acp-agent'

// Orca and its release, as BAD-836 names it to agy; read per launch so a test or update sees its own.
function customAcpClientInfo(): Implementation {
  return {
    name: ORCA_ACP_CLIENT_INFO.name,
    version: process.env.ORCA_APP_VERSION?.trim() || '0.0.0-dev'
  }
}

const OrcaSystemPromptCapability = lazyZodSchema(() =>
  z.object({ orca: z.object({ systemPrompt: z.literal(true) }) })
)

/** Whether the agent's initialize offers `_meta.orca.systemPrompt` on its sessions. */
export function customAcpTakesSystemPrompt(initialized: InitializeResponse): boolean {
  return OrcaSystemPromptCapability.safeParse(initialized.agentCapabilities?._meta).success
}

function systemPromptRefusal(name: string): string {
  return (
    `${name} does not take Orca's standing instructions (its initialize advertises no ` +
    `agentCapabilities._meta.orca.systemPrompt), so this chat did not start. For an agent that ` +
    `keeps its own persona, save it with --owns-prompt (orca agent custom add ${name} ... ` +
    `--owns-prompt --replace).`
  )
}

/** Not owned: the whole text in `_meta.orca.systemPrompt`, which the agent must say it takes, or
 *  the chat does not start (a bot would run without its SOUL.md and MEMORY.md). Owned: Orca's bot
 *  rules as `_meta.orca.context`, which the agent may use or ignore. Both are sent again on every
 *  start and reopen, so an edit reaches the next one. */
function customAcpInstructions(name: string, ownsPrompt: boolean): AcpInstructionsDelivery {
  return {
    eachStart: true,
    launch: async ({ text }) =>
      ownsPrompt
        ? {
            sessionMeta: { orca: { context: text } },
            sessionMetaOnReopen: true,
            sessionMetaOptional: true
          }
        : {
            sessionMeta: { orca: { systemPrompt: text } },
            sessionMetaOnReopen: true,
            // The handshake reports a refusal only by name; this one says what to change, in the
            // chat's failure Details.
            takesSessionMeta: (initialized) => {
              if (customAcpTakesSystemPrompt(initialized)) {
                return true
              }
              const refusal = systemPromptRefusal(name)
              throw withProviderDiagnostic(
                new Error(refusal),
                providerDiagnostic(refusal, 'person')
              )
            }
          }
  }
}

// No CLI of its own, so no terminal history to adopt or resume from.
const CUSTOM_ACP_SESSION_HISTORY: StructuredAgentSessionHistory = {
  rowAgents: [],
  rowSessionId: (link) => link.handle.nativeId,
  parseResumeArgs: () => null
}

/** `problem` refuses every start before the program spawns, saying why. */
function customAcpAccount(problem: string | null): AcpAccountBinding {
  return {
    pin: { accountHomeVariable: CUSTOM_ACP_HOME_VARIABLE },
    // A chat that names no agent never runs; the create path pins the agent it picked.
    resolve: async ({ stateDirectory }) => forkCustomAcpUnpinnedHome(stateDirectory),
    environment: (home, env) => {
      if (!isLegacyAgentSessionAccountHome(home) || home.variable !== CUSTOM_ACP_HOME_VARIABLE) {
        throw new Error(`sessions of this agent pin ${CUSTOM_ACP_HOME_VARIABLE}`)
      }
      return { ...env, [CUSTOM_ACP_HOME_VARIABLE]: home.path }
    },
    prepare: async (env) => {
      if (problem) {
        throw new Error(problem)
      }
      const home = env[CUSTOM_ACP_HOME_VARIABLE]
      if (!home) {
        throw new Error(`${CUSTOM_ACP_HOME_VARIABLE} is not set`)
      }
      await mkdir(home, { recursive: true, mode: 0o700 })
      await chmod(home, 0o700)
    }
  }
}

export const CUSTOM_ACP_LAUNCH_SPEC: AcpLaunchSpec = {
  agent: CUSTOM_ACP_AGENT,
  command: UNPINNED_COMMAND,
  // Settings > Agents has no Command row for it; the saved agent names its program.
  ignoreAgentCommandSetting: true,
  args: () => [],
  env: {},
  dialect: {},
  clientInfo: customAcpClientInfo(),
  loginCommand: [],
  account: customAcpAccount('This chat names no custom agent, so it cannot start.'),
  installDirectories: () => [],
  modelDiscovery: {
    kind: 'unavailable',
    reason: 'A custom ACP agent picks its own model; Orca lists none for it'
  },
  instructions: customAcpInstructions(CUSTOM_ACP_AGENT, false),
  // Orca's visuals skill is not offered to a custom agent, so nothing asks for its version.
  instructionsInWorkspace: true,
  transcriptImport: null,
  sessionHistory: CUSTOM_ACP_SESSION_HISTORY,
  // Orca cannot tell whether it deletes sessions, so it runs no naming tasks on it.
  keepsEverySession: true
}

function pinnedSpec(agent: ForkCustomAcpAgent): AcpLaunchSpec {
  const values = forkCustomAcpAgentEnvValues(agent.name)
  const env = Object.fromEntries(
    (agent.env ?? []).flatMap((name) => (values[name] === undefined ? [] : [[name, values[name]]]))
  )
  return {
    ...CUSTOM_ACP_LAUNCH_SPEC,
    command: agent.command,
    args: () => [...(agent.args ?? [])],
    env,
    ...(agent.cwd ? { processCwd: agent.cwd } : {}),
    clientInfo: customAcpClientInfo(),
    account: customAcpAccount(
      forkCustomAcpEnvStoreLoaded()
        ? null
        : 'Custom agents are still loading on this host; try again.'
    ),
    instructions: customAcpInstructions(agent.name, agent.ownsPrompt === true)
  }
}

/** The spec a chat pinned to `home` launches. It never throws: a chat whose agent was removed
 *  refuses at its start, before anything spawns, with the reason. */
export function forkCustomAcpLaunchSpec(
  spec: AcpLaunchSpec,
  home: AgentSessionAccountHome
): AcpLaunchSpec {
  const name = forkCustomAcpAgentNameOfHome(home)
  if (!name) {
    return spec
  }
  const agent = forkCustomAcpAgentNamed(name)
  return agent
    ? pinnedSpec(agent)
    : {
        ...spec,
        account: customAcpAccount(
          `The custom agent ${name} is not saved on this host any more; add it again with orca agent custom add ${name}.`
        )
      }
}
