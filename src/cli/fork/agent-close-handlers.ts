// BAD-848 (FORK.md "Auto-close finished automation run chats"): `orca agent close`, through the
// host's fork.agent.close RPC (on the paired server --environment names).
import type { CommandHandler } from '../dispatch/dispatch'
import { getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  FORK_AGENT_CLOSE_METHOD,
  forkAgentCloseText,
  type ForkAgentCloseResult
} from '../../shared/fork/agent-chat-close'

export const FORK_AGENT_CLOSE_HANDLERS: Record<string, CommandHandler> = {
  'agent close': async (ctx) => {
    const response = await ctx.client
      .call<ForkAgentCloseResult>(FORK_AGENT_CLOSE_METHOD, {
        id: getRequiredStringFlag(ctx.flags, 'id')
      })
      .catch((error: unknown) => {
        if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
          throw new RuntimeClientError(
            'incompatible_runtime',
            'This Orca host cannot close chats from the CLI yet. Update it and try again.'
          )
        }
        throw error
      })
    const result = response.result
    if (!result.closed && !ctx.json) {
      throw new RuntimeClientError(
        `chat_${result.reason.replace(/-/g, '_')}`,
        forkAgentCloseText(result)
      )
    }
    printResult(response, ctx.json, forkAgentCloseText)
  }
}
