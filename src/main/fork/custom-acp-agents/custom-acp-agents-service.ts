// FORK.md "Custom ACP agents": saving, listing and removing custom agents, and starting a chat on
// one. Definitions live in settings (forkCustomAcpAgents); env values in the host's private store.
import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import { createOrcaSessionId } from '../../../shared/agent-session/identity/orca-session-address'
import { createStructuredAgentSessionOperationId } from '../../../shared/agent-session/lifecycle/operations/structured-agent-session-mutation'
import {
  CUSTOM_ACP_AGENT,
  CUSTOM_ACP_AGENT_LIMITS,
  CUSTOM_ACP_AGENT_OPTION_ID,
  customAcpAgentNameProblem,
  customAcpAgentProblem,
  type ForkCustomAcpAgent
} from '../../../shared/fork/custom-acp-agents/custom-acp-agent-types'
import type {
  ForkCustomAcpAgentAddParams,
  ForkCustomAcpAgentRow,
  ForkCustomAcpAgentStartChatParams,
  ForkCustomAcpAgentStartChatResult
} from '../../../shared/fork/custom-acp-agents/custom-acp-agents-wire'
import type { StructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-host'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { RuntimeStore } from '../../runtime/construction/runtime-store-contract'
import { createStructuredAgentSessionForWorktree } from '../../runtime/rpc/methods/structured-sessions/creation/structured-agent-session-create'
import {
  forkCustomAcpAgentEnvValues,
  saveForkCustomAcpAgentEnv
} from './custom-acp-agent-env-store'
import { forkCustomAcpAgents } from './custom-acp-agents-host'

/** The settings store as the RPC methods reach it; reads go through the host's install. */
export type CustomAcpSettingsStore = Pick<RuntimeStore, 'updateSettings'>

export class CustomAcpAgentError extends Error {}

export function forkCustomAcpAgentRows(): ForkCustomAcpAgentRow[] {
  return forkCustomAcpAgents().map((agent) => {
    const values = forkCustomAcpAgentEnvValues(agent.name)
    const missing = (agent.env ?? []).filter((name) => values[name] === undefined)
    return missing.length > 0 ? { ...agent, envMissing: missing } : agent
  })
}

function saveAgents(store: CustomAcpSettingsStore, agents: ForkCustomAcpAgent[]): void {
  if (!store.updateSettings) {
    throw new CustomAcpAgentError(
      'This host cannot save settings, so it cannot save custom agents.'
    )
  }
  store.updateSettings({ forkCustomAcpAgents: agents }, { notifyListeners: true })
}

/** Saves a new agent, or replaces one with `replace`; env values go to the private store first, so
 *  a start never sees a name whose value is still on its way. */
export async function addForkCustomAcpAgent(
  store: CustomAcpSettingsStore,
  params: z.infer<typeof ForkCustomAcpAgentAddParams>
): Promise<ForkCustomAcpAgentRow> {
  const agent: ForkCustomAcpAgent = {
    name: params.name,
    command: params.command.trim(),
    ...(params.args?.length ? { args: params.args } : {}),
    ...(params.cwd ? { cwd: params.cwd } : {}),
    ...(params.env && Object.keys(params.env).length > 0 ? { env: Object.keys(params.env) } : {}),
    ...(params.ownsPrompt ? { ownsPrompt: true } : {})
  }
  const problem = customAcpAgentProblem(agent)
  if (problem) {
    throw new CustomAcpAgentError(problem)
  }
  const saved = forkCustomAcpAgents()
  const taken = saved.some((entry) => entry.name === agent.name)
  if (taken && !params.replace) {
    throw new CustomAcpAgentError(
      `A custom agent named ${agent.name} is already saved; pass --replace to change it.`
    )
  }
  if (!taken && saved.length >= CUSTOM_ACP_AGENT_LIMITS.agents) {
    throw new CustomAcpAgentError(`At most ${CUSTOM_ACP_AGENT_LIMITS.agents} custom agents.`)
  }
  await saveForkCustomAcpAgentEnv(agent.name, params.env ?? null)
  saveAgents(store, [...saved.filter((entry) => entry.name !== agent.name), agent])
  return forkCustomAcpAgentRows().find((row) => row.name === agent.name) ?? agent
}

/** Removes the agent and its env values. Its folder stays, so adding it again finds its state. */
export async function removeForkCustomAcpAgent(
  store: CustomAcpSettingsStore,
  name: string
): Promise<{ removed: boolean }> {
  const saved = forkCustomAcpAgents()
  if (!saved.some((entry) => entry.name === name)) {
    return { removed: false }
  }
  saveAgents(
    store,
    saved.filter((entry) => entry.name !== name)
  )
  await saveForkCustomAcpAgentEnv(name, null)
  return { removed: true }
}

async function requireHost(runtime: OrcaRuntimeService): Promise<StructuredAgentSessionHost> {
  await runtime.ensureStructuredAgentSessionHost()
  const host = getStructuredAgentSessionHost()
  if (!host) {
    throw new CustomAcpAgentError('This host runs no native chats.')
  }
  return host
}

/** A new chat on the agent `params.name`, like a chat from the new-chat menu: a person's start. */
export async function startForkCustomAcpChat(
  runtime: OrcaRuntimeService,
  params: z.infer<typeof ForkCustomAcpAgentStartChatParams>,
  callerKey: string
): Promise<ForkCustomAcpAgentStartChatResult> {
  const nameProblem = customAcpAgentNameProblem(params.name)
  if (nameProblem) {
    throw new CustomAcpAgentError(nameProblem)
  }
  const prompt = params.prompt?.trim()
  const created = await createStructuredAgentSessionForWorktree({
    runtime,
    ensureHost: () => requireHost(runtime),
    caller: { callerKey },
    envelope: {
      sessionId: createOrcaSessionId(randomUUID),
      clientOperationId: createStructuredAgentSessionOperationId(randomUUID),
      expectedRuntimeFence: null,
      payloadFingerprint: ''
    },
    worktree: params.worktree,
    agent: CUSTOM_ACP_AGENT,
    options: { [CUSTOM_ACP_AGENT_OPTION_ID]: params.name },
    atRest: true,
    ...(prompt
      ? {
          firstMessage: {
            clientMessageId: randomUUID(),
            body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: prompt }] }
          }
        }
      : {}),
    activate: params.focus !== false
  })
  if (!created.ok) {
    throw new CustomAcpAgentError(created.refusal.message || created.refusal.code)
  }
  return {
    sessionId: created.value.sessionId,
    ...(created.value.tabId ? { tabId: created.value.tabId } : {})
  }
}
