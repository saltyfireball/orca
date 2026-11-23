// Read-only runs (FORK.md, BAD-795): a bot's look-around or tidy-up runs in a hidden chat, so a
// permission prompt there has nobody to answer it and would leave the run blocked for good. Its
// PreToolUse hook already answers every call; a prompt that still comes is refused at once.
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import {
  LOOK_AROUND_REFUSAL,
  REPLY_ONLY_REFUSAL,
  type ReadOnlySessionMode
} from '../../bots/bot-look-around-policy'

export function forkReadOnlyPromptRefusal(
  mode: ReadOnlySessionMode,
  toolUseId: string | undefined
): PermissionResult {
  return {
    behavior: 'deny',
    message: mode === 'look-around' ? LOOK_AROUND_REFUSAL : REPLY_ONLY_REFUSAL,
    ...(toolUseId ? { toolUseID: toolUseId } : {})
  }
}
