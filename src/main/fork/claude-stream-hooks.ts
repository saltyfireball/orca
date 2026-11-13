// Fork hooks for openClaudeStreamJsonConnection (FORK.md "Chat survive consumed hook"). That
// upstream file sits at max-lines, so its hook is one changed line and its exit-error import comes
// through here with the hook: one import line, no added lines.
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { forkChatSurviveConsumed } from './chat-survive/chat-survive-registry'

export { claudeStreamJsonExitError } from '../claude/claude-stream-json-exit-error'

/** Hands a message to the chat, then moves the chat-survive replay mark past it (SLRM-1394). */
export function forkConsumeClaudeMessage(
  child: ChildProcessWithoutNullStreams | null | undefined,
  message: Record<string, unknown>,
  handlers: { onMessage?: (message: Record<string, unknown>) => void }
): void {
  handlers.onMessage?.(message)
  forkChatSurviveConsumed(child, message)
}
