// Command guards (FORK.md, BAD-764): which native chats and chat workers started on this host have
// a working guard hook, so `orca command-guards status` can show a chat that has none as unguarded.
// Every chat is launched with the hook. A chat carried over an app restart (chat survive) was started
// by the earlier app, whose hook answers no more: it counts as unguarded until Claude Code confirms
// it took this app's hook, or that hook is called.
// Keep electron out of this file.
import type { ForkCommandGuardsStatusResult } from '../../../shared/fork/command-guards-wire'
import {
  commandGuardSurfaceCoverage,
  type CommandGuardSurface,
  type CommandGuardSurfaceCoverage
} from '../../../shared/fork/command-guards'

export type GuardedChatSurface = Extract<CommandGuardSurface, 'native-chat' | 'chat-worker'>

const MAX_CHATS = 500
const chats = new Map<string, { surface: GuardedChatSurface; unconfirmed: boolean }>()

const NOT_RUNNING = 'the command guards are not running on its host'
const UNCONFIRMED =
  'this chat was carried over an app restart and Claude Code has not confirmed its guard hook yet'

/** Records the newest launch of a chat, with the guard hook in its options. */
export function noteCommandGuardChat(sessionId: string, surface: GuardedChatSurface): void {
  chats.delete(sessionId)
  chats.set(sessionId, { surface, unconfirmed: false })
  if (chats.size > MAX_CHATS) {
    const oldest = chats.keys().next().value
    if (oldest !== undefined) {
      chats.delete(oldest)
    }
  }
}

/** Hook (chat survive): this launch took over a provider that an earlier app instance started. */
export function noteCommandGuardChatAdopted(sessionId: string): void {
  const chat = chats.get(sessionId)
  if (chat) {
    chat.unconfirmed = true
  }
}

/** The hook of the newest launch works: Claude Code called it, or confirmed it (below). */
export function noteCommandGuardChatAnswers(sessionId: string): void {
  const chat = chats.get(sessionId)
  if (chat) {
    chat.unconfirmed = false
  }
}

/**
 * Hook (the reply to a launch's initialize): Claude Code says whether it took the hooks sent with
 * it. Versions that do not say ignore the hooks of any initialize after the first.
 */
export function noteCommandGuardChatInitialized(sessionId: string, reply: unknown): void {
  if (
    typeof reply === 'object' &&
    reply !== null &&
    'hooks_applied' in reply &&
    reply.hooks_applied === true
  ) {
    noteCommandGuardChatAnswers(sessionId)
  }
}

/** The chats this host started, for an agent's guard line; `running` is whether the guards run here. */
export function forkCommandGuardChatList(
  running: boolean
): NonNullable<ForkCommandGuardsStatusResult['chats']> {
  return [...chats].map(([sessionId, { surface, unconfirmed }]) => ({
    sessionId,
    surface,
    guarded: running && !unconfirmed,
    ...(running ? (unconfirmed ? { reason: UNCONFIRMED } : {}) : { reason: NOT_RUNNING })
  }))
}

export function resetCommandGuardChats(): void {
  chats.clear()
}

/** The per-surface coverage with this host's live chats: any chat without a guard makes its surface unguarded. */
export function forkCommandGuardChatSurfaces(running: boolean): CommandGuardSurfaceCoverage[] {
  const list = forkCommandGuardChatList(running)
  return commandGuardSurfaceCoverage().map((row) => {
    if (row.surface === 'terminal') {
      return row
    }
    const mine = list.filter((chat) => chat.surface === row.surface)
    const unguarded = mine.filter((chat) => !chat.guarded).length
    return {
      ...row,
      guarded: row.guarded && unguarded === 0,
      note:
        row.guarded && unguarded > 0
          ? `unguarded: ${unguarded} chat${unguarded === 1 ? '' : 's'} ${running ? 'carried over an app restart, guard hook not confirmed by Claude Code yet' : 'started without a guard attached'}`
          : row.note,
      chats: { guarded: mine.length - unguarded, unguarded }
    }
  })
}
