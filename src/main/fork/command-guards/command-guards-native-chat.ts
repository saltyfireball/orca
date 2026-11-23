// Command guards (FORK.md, BAD-764): the guard for native Claude chats and chat workers. Their
// child has no pane identity or hook endpoint (the seal drops them on purpose, so one chat cannot
// pose as another), so the terminal hook script never reaches Orca. Instead Orca answers
// PreToolUse itself, as an in-process hook callback of the Claude Agent SDK: it runs with Orca's
// own session id, needs no variable in the child, and still runs in Full access. Not a sandbox.
// Keep electron out of this file.
import type { HookCallback, HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'
import { resolveStructuredWorkerIdentityForSession } from '../../runtime/orchestration/terminal-authority/structured-sessions/structured-worker-authority'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { noteCommandGuardChat, type GuardedChatSurface } from './command-guards-chat-registry'
import { forkCommandGuardsRunning, guardShellCommand } from './command-guards-live'

function surfaceOf(sessionId: string): GuardedChatSurface {
  try {
    return resolveStructuredWorkerIdentityForSession(sessionId, null)
      ? 'chat-worker'
      : 'native-chat'
  } catch {
    return 'native-chat'
  }
}

function workspaceOf(sessionId: string, cwd: string): string {
  try {
    return (
      getStructuredAgentSessionHost()?.deps.store.getRecord(sessionId)?.location.workspaceId ?? cwd
    )
  } catch {
    return cwd
  }
}

function denial(reason: string): Awaited<ReturnType<HookCallback>> {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }
}

/**
 * The chat's SDK options with `hooks` added (they reach `query` through the launch options): a shell command that breaks a rule is denied and audited. Returns
 * the options as they are, and the chat shows unguarded, when the guards are not running on this host.
 */
export function forkChatGuardOptions<T extends object>(
  options: T,
  sessionId: string,
  cwd: string
): T {
  const surface = surfaceOf(sessionId)
  if (!forkCommandGuardsRunning()) {
    noteCommandGuardChat(sessionId, surface, false)
    return options
  }
  noteCommandGuardChat(sessionId, surface, true)
  const workspaceId = workspaceOf(sessionId, cwd)
  const guard: HookCallback = (input) => {
    if (input.hook_event_name !== 'PreToolUse') {
      return Promise.resolve({})
    }
    const tool_input: unknown = input.tool_input
    const command =
      typeof tool_input === 'object' && tool_input !== null && 'command' in tool_input
        ? tool_input.command
        : null
    if (typeof command !== 'string') {
      return Promise.resolve({})
    }
    const reason = guardShellCommand({
      agent: 'claude',
      surface: surfaceOf(sessionId),
      command,
      workspaceId,
      root: cwd
    })
    return Promise.resolve(reason ? denial(reason) : {})
  }
  // A fault in the callback continues the call, as everywhere else in the guard.
  const PreToolUse: HookCallbackMatcher[] = [
    { matcher: 'Bash', hooks: [guard], onFailure: 'continue' }
  ]
  return { ...options, hooks: { PreToolUse } }
}
