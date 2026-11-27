// `orca agent close` and `fork.agent.close` (FORK.md, BAD-848): close one finished chat's tab with
// its history kept, by its Orca session ID.
import * as z from 'zod'

export const FORK_AGENT_CLOSE_METHOD = 'fork.agent.close'

export const ForkAgentCloseParams = z.object({ id: z.string().min(1).max(512) })
export type ForkAgentCloseParams = z.infer<typeof ForkAgentCloseParams>

export type ForkAgentCloseResult =
  | { closed: true; sessionId: string; alreadyClosed?: true }
  | {
      closed: false
      sessionId?: string
      reason: 'not-a-chat' | 'not-found' | 'working' | 'unreadable' | 'failed'
      detail?: string
    }

export function forkAgentCloseText(result: ForkAgentCloseResult): string {
  if (result.closed) {
    return result.alreadyClosed
      ? `Chat ${result.sessionId} has no open tab; nothing to close.`
      : `Closed chat ${result.sessionId}. Its history is kept; reopen it from Session History or its run.`
  }
  switch (result.reason) {
    case 'not-a-chat':
      return 'That ID names a terminal agent, not a chat. Close its terminal with `orca terminal close`.'
    case 'not-found':
      return 'No chat with that ID on this host.'
    case 'working':
      return 'The chat is working or waiting on you. Stop it or answer it first, then close it.'
    case 'unreadable':
      return "Orca can't tell whether the chat is working right now, so it was left open. Try again in a moment."
    case 'failed':
      return `The chat did not close${result.detail ? `: ${result.detail}` : '.'}`
  }
}
