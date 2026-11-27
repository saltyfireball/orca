// The fork.customAcpAgents.* RPC contract between `orca agent custom`, the new-chat menu and the host.
import { z } from 'zod'
import { lazyZodSchema } from '../../schema/lazy-zod-schema'
import { CUSTOM_ACP_AGENT_LIMITS, type ForkCustomAcpAgent } from './custom-acp-agent-types'

const name = () => z.string().min(1).max(40)

export const ForkCustomAcpAgentsListParams = lazyZodSchema(() => z.object({}))

export const ForkCustomAcpAgentAddParams = lazyZodSchema(() =>
  z.object({
    name: name(),
    command: z.string().min(1).max(CUSTOM_ACP_AGENT_LIMITS.commandChars),
    args: z
      .array(z.string().max(CUSTOM_ACP_AGENT_LIMITS.argChars))
      .max(CUSTOM_ACP_AGENT_LIMITS.args)
      .optional(),
    cwd: z.string().min(1).max(4096).optional(),
    /** Name to value; only the names are saved in settings, the values in the host's private store. */
    env: z
      .record(z.string().max(128), z.string().max(CUSTOM_ACP_AGENT_LIMITS.envValueChars))
      .refine((env) => Object.keys(env).length <= CUSTOM_ACP_AGENT_LIMITS.env)
      .optional(),
    ownsPrompt: z.boolean().optional(),
    /** Replace an agent of the same name; without it a taken name is refused. */
    replace: z.boolean().optional()
  })
)

export const ForkCustomAcpAgentRemoveParams = lazyZodSchema(() => z.object({ name: name() }))

export const ForkCustomAcpAgentStartChatParams = lazyZodSchema(() =>
  z.object({
    name: name(),
    /** A worktree selector, as `orca agent launch --worktree` takes. */
    worktree: z.string().min(1).max(4096),
    prompt: z.string().max(200_000).optional(),
    focus: z.boolean().optional()
  })
)

/** A saved agent as reads show it: env names, never their values. */
export type ForkCustomAcpAgentRow = ForkCustomAcpAgent & {
  /** Env names with no value in this host's store, so the agent starts without them. */
  envMissing?: string[]
}

export type ForkCustomAcpAgentsListResult = { agents: ForkCustomAcpAgentRow[] }

export type ForkCustomAcpAgentStartChatResult = {
  sessionId: string
  tabId?: string
}
