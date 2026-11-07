// Which native chats a quit or restart would cut off: the provider child dies with the app (FORK.md).
import type { AgentSessionStatusSummary } from '../../../shared/agent-session/agent-session-wire'
import { getWorktreePathBasenameFromId } from '../../../shared/worktree/id'

export type BusyChatActivity =
  | { kind: 'turn'; toolName?: string }
  | { kind: 'question' }
  | { kind: 'children'; subagents: number; commands: number }

export type BusyChat = {
  sessionId: string
  name: string
  workspace: string
  activity: BusyChatActivity
}

const LIVE_STATES = new Set(['working', 'monitoring', 'waiting', 'blocked'])
const NAME_MAX = 60

function countRunningChildren(
  summary: AgentSessionStatusSummary
): { subagents: number; commands: number } | null {
  let subagents = 0
  let commands = 0
  const add = (kind: string): void => {
    if (kind === 'command' || kind === 'monitor') {
      commands++
    } else {
      subagents++
    }
  }
  if (summary.children) {
    for (const child of summary.children) {
      if (child.membership === 'live' && LIVE_STATES.has(child.state)) {
        add(child.kind)
      }
    }
  } else {
    for (const task of summary.backgroundTasks ?? []) {
      // A task without a state comes from an older host that cannot say it is running.
      if (task.state !== undefined && LIVE_STATES.has(task.state)) {
        add(task.kind)
      }
    }
  }
  return subagents + commands > 0 ? { subagents, commands } : null
}

function chatName(summary: AgentSessionStatusSummary): string {
  const named = summary.conversationName?.trim()
  if (named) {
    return named
  }
  const prompt = summary.latestPrompt.replace(/\s+/g, ' ').trim()
  if (!prompt) {
    return ''
  }
  return prompt.length > NAME_MAX ? `${prompt.slice(0, NAME_MAX - 3)}...` : prompt
}

/** A chat is busy only while this app owns its provider child and that child has work in flight. */
export function readBusyChat(summary: AgentSessionStatusSummary): BusyChat | null {
  if (summary.hostExecutionOwned !== true) {
    return null
  }
  let activity: BusyChatActivity | null = null
  if (summary.status === 'working') {
    activity = { kind: 'turn', ...(summary.toolName ? { toolName: summary.toolName } : {}) }
  } else if (summary.status === 'attention') {
    activity = { kind: 'question' }
  } else {
    const children = countRunningChildren(summary)
    activity = children ? { kind: 'children', ...children } : null
  }
  if (!activity) {
    return null
  }
  return {
    sessionId: summary.sessionId,
    name: chatName(summary),
    workspace: getWorktreePathBasenameFromId(summary.workspaceId) ?? '',
    activity
  }
}

/**
 * `survives` (SLRM-1394) says a Claude chat's provider would carry on under its chat-survive
 * broker through the quit; such a chat loses nothing and is not busy. Codex chats always count.
 */
export function listBusyChats(
  summaries: readonly (AgentSessionStatusSummary | undefined)[],
  survives: (sessionId: string) => boolean = () => false
): BusyChat[] {
  const busy: BusyChat[] = []
  for (const summary of summaries) {
    const carriesOn = summary?.agent === 'claude' && survives(summary.sessionId)
    const chat = summary && !carriesOn ? readBusyChat(summary) : null
    if (chat) {
      busy.push(chat)
    }
  }
  return busy
}
