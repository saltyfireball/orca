// Command guards (FORK.md, BAD-764): which native chats and chat workers started on this host have
// a guard attached, so `orca command-guards status` can show a chat that has none as unguarded.
// Keep electron out of this file.
import {
  commandGuardSurfaceCoverage,
  type CommandGuardSurface,
  type CommandGuardSurfaceCoverage
} from '../../../shared/fork/command-guards'

export type GuardedChatSurface = Extract<CommandGuardSurface, 'native-chat' | 'chat-worker'>

const MAX_CHATS = 500
const chats = new Map<string, { surface: GuardedChatSurface; guarded: boolean }>()

/** Records the newest launch of a chat: a relaunch without a guard replaces an earlier guarded one. */
export function noteCommandGuardChat(
  sessionId: string,
  surface: GuardedChatSurface,
  guarded: boolean
): void {
  chats.delete(sessionId)
  chats.set(sessionId, { surface, guarded })
  if (chats.size > MAX_CHATS) {
    const oldest = chats.keys().next().value
    if (oldest !== undefined) {
      chats.delete(oldest)
    }
  }
}

/** The chats this host started, for an agent's guard line. */
export function forkCommandGuardChatList(): {
  sessionId: string
  surface: GuardedChatSurface
  guarded: boolean
}[] {
  return [...chats].map(([sessionId, chat]) => ({ sessionId, ...chat }))
}

export function resetCommandGuardChats(): void {
  chats.clear()
}

/** The per-surface coverage with this host's live chats: any chat without a guard makes its surface unguarded. */
export function forkCommandGuardChatSurfaces(): CommandGuardSurfaceCoverage[] {
  return commandGuardSurfaceCoverage().map((row) => {
    if (row.surface === 'terminal') {
      return row
    }
    const mine = [...chats.values()].filter((chat) => chat.surface === row.surface)
    const unguarded = mine.filter((chat) => !chat.guarded).length
    return {
      ...row,
      guarded: row.guarded && unguarded === 0,
      note:
        row.guarded && unguarded > 0
          ? `unguarded: ${unguarded} chat${unguarded === 1 ? '' : 's'} started without a guard attached`
          : row.note,
      chats: { guarded: mine.length - unguarded, unguarded }
    }
  })
}
