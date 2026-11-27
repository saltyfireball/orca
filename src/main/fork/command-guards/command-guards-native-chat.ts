// Command guards (FORK.md, BAD-764): the guard for native Claude chats and chat workers. Their
// child has no pane identity or hook endpoint (the seal drops them on purpose, so one chat cannot
// pose as another), so the terminal hook script never reaches Orca. Instead Orca answers
// PreToolUse itself, as an in-process hook callback of the Claude Agent SDK: it runs with Orca's
// own session id, needs no variable in the child, and still runs in Full access. Not a sandbox.
// Keep electron out of this file.
import type { HookCallback, HookCallbackMatcher, Options } from '@anthropic-ai/claude-agent-sdk'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import {
  CLAUDE_SHELL_TOOLS,
  shellCommandOfToolCall
} from '../../../shared/fork/command-guards-shell-tools'
import { noteCommandGuardChat, noteCommandGuardChatAnswers } from './command-guards-chat-registry'
import { commandGuardChatSurface, liveCommandGuardChats } from './command-guards-live-chats'
import { forkCommandGuardsReady, guardShellCommand } from './command-guards-live'

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
 * The chat's SDK options with the guard added to whatever hooks they carry (they reach `query`
 * through the launch options): a shell command that breaks a rule is denied and audited. The
 * options' own hooks stay first and whole: a read-only session's PreToolUse hook is its limit
 * (BAD-795), and Claude Code takes the strictest of several answers (deny over ask over allow).
 * The hook is attached whatever the state at launch: a launch may come before the guards start, and
 * a chat taken over from an earlier app instance keeps that instance's dead hooks unless it is sent
 * new ones, so Claude Code would let every call through. Whether the guards run here, and what the
 * settings say, is read at each call.
 */
export function forkChatGuardOptions<T extends Pick<Options, 'hooks'>>(
  options: T,
  sessionId: string,
  cwd: string
): T {
  noteCommandGuardChat(sessionId, commandGuardChatSurface(sessionId), liveCommandGuardChats)
  const workspaceId = workspaceOf(sessionId, cwd)
  const guard: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PreToolUse') {
      return {}
    }
    const surface = commandGuardChatSurface(sessionId)
    noteCommandGuardChatAnswers(sessionId, surface)
    const command = shellCommandOfToolCall(input.tool_name, input.tool_input)
    if (command === null || !(await forkCommandGuardsReady())) {
      return {}
    }
    const reason = await guardShellCommand({
      agent: 'claude',
      surface,
      command,
      workspaceId,
      root: cwd,
      sessionId
    })
    return reason ? denial(reason) : {}
  }
  // A fault in the callback continues the call, as everywhere else in the guard.
  const added: HookCallbackMatcher = {
    matcher: CLAUDE_SHELL_TOOLS.join('|'),
    hooks: [guard],
    onFailure: 'continue'
  }
  const kept = options.hooks ?? {}
  return { ...options, hooks: { ...kept, PreToolUse: [...(kept.PreToolUse ?? []), added] } }
}
