// Command guards (FORK.md, BAD-686): one agent's guard line, for its row in `orca agent list|show`
// and the app's agent rows. Read only from the agent's host's `fork.commandGuards.status`, so the
// line and the status can never disagree. Pure.
import { sleeperChatSessionId } from './sleepers-ps-sources'
import { commandGuardSurfaceGuardedNote, type CommandGuardSurface } from './command-guards'
import type { ForkCommandGuardsStatusResult } from './command-guards-wire'

/** Guarded, or unguarded with the reason in `note`. */
export type CommandGuardAgentLine = { guarded: boolean; note: string }

export type CommandGuardAgentSubject = {
  agent: string | null | undefined
  paneKey: string
  worktreeId: string
  /** A chat's session; without it the pane key names it in the host's form. */
  sessionId?: string | null
}

/** A chat nothing is known about is not guarded. */
export const COMMAND_GUARD_UNKNOWN_CHAT =
  'this chat is not known to this app: it has not started it, or lost track of it'

// Agent types that run Claude Code and so post through its hook.
const CLAUDE_AGENT_TYPES = new Set(['claude', 'claude-agent-teams'])

function unguarded(note: string): CommandGuardAgentLine {
  return { guarded: false, note: note.startsWith('unguarded') ? note : `unguarded: ${note}` }
}

function surfaceLine(
  status: ForkCommandGuardsStatusResult,
  surface: CommandGuardSurface,
  subject: CommandGuardAgentSubject,
  sessionId: string | null
): CommandGuardAgentLine {
  const row = status.surfaces?.find((entry) => entry.surface === surface)
  if (sessionId && !status.chats) {
    return unguarded('its host does not say which of its chats have the guard')
  }
  if (!row) {
    // A host from before surfaces were told apart: its Claude row is all it says.
    const claude = status.agents.find((entry) => entry.agent === 'claude')
    return claude?.guarded
      ? { guarded: true, note: claude.note }
      : unguarded(claude?.note ?? 'this host does not say whether Claude Code is guarded')
  }
  if (row.proof === null) {
    return unguarded(row.note)
  }
  if (surface === 'terminal' && status.unguardedWorkspaces?.includes(subject.worktreeId)) {
    return unguarded(
      'this workspace has no folder on its host (a folder workspace on an SSH host or in WSL, or one the host does not know), so its shell commands go through unchecked'
    )
  }
  if (sessionId) {
    const chat = status.chats?.find((entry) => entry.sessionId === sessionId)
    if (!chat) {
      return unguarded(COMMAND_GUARD_UNKNOWN_CHAT)
    }
    if (!chat.guarded) {
      return unguarded(
        chat.reason ?? 'this chat started while the guards were not running on its host'
      )
    }
  }
  return { guarded: true, note: commandGuardSurfaceGuardedNote(surface) }
}

/** The line for one agent; null when the host's command guards are off by setting. */
export function commandGuardAgentLine(
  status: ForkCommandGuardsStatusResult,
  subject: CommandGuardAgentSubject
): CommandGuardAgentLine | null {
  if (!status.enabled) {
    return null
  }
  const sessionId = subject.sessionId ?? sleeperChatSessionId(subject.paneKey)
  const agent = subject.agent ?? null
  if (agent && CLAUDE_AGENT_TYPES.has(agent)) {
    const chat = sessionId ? status.chats?.find((entry) => entry.sessionId === sessionId) : null
    const surface: CommandGuardSurface = sessionId ? (chat?.surface ?? 'native-chat') : 'terminal'
    return surfaceLine(status, surface, subject, sessionId)
  }
  if (!agent) {
    return unguarded('Orca does not know which agent runs here')
  }
  const row = status.agents.find((entry) => entry.agent === agent)
  if (!row) {
    return unguarded('Orca has no hook in this agent that could block a call')
  }
  return row.guarded ? { guarded: true, note: row.note } : unguarded(row.note)
}
