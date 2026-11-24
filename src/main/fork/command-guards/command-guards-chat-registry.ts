// Command guards (FORK.md, BAD-764): which native chats and chat workers started on this host have
// a working guard hook, so `orca command-guards status` can show a chat that has none as unguarded.
// Every chat is launched with the hook. A chat carried over an app restart (chat survive) was started
// by the earlier app, whose hook answers no more: it counts as unguarded until Claude Code confirms
// it took this app's hook, or that hook is called. A live chat this registry does not know is
// unguarded too. Keep electron out of this file.
import type { ForkCommandGuardsStatusResult } from '../../../shared/fork/command-guards-wire'
import { COMMAND_GUARD_UNKNOWN_CHAT } from '../../../shared/fork/command-guards-agent-line'
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

/** The live chats of this host by session id (liveCommandGuardChats). */
export type LiveGuardChats = ReadonlyMap<string, GuardedChatSurface>

/** Over the limit the oldest ended chat goes; a live one stays, however many there are. */
function dropEndedChat(newest: string, live: () => LiveGuardChats): void {
  if (chats.size <= MAX_CHATS) {
    return
  }
  const running = live()
  for (const sessionId of chats.keys()) {
    if (sessionId !== newest && !running.has(sessionId)) {
      chats.delete(sessionId)
      return
    }
  }
}

/** Records the newest launch of a chat, with the guard hook in its options. */
export function noteCommandGuardChat(
  sessionId: string,
  surface: GuardedChatSurface,
  live: () => LiveGuardChats
): void {
  chats.delete(sessionId)
  chats.set(sessionId, { surface, unconfirmed: false })
  dropEndedChat(sessionId, live)
}

/** Hook (chat survive): this launch took over a provider that an earlier app instance started. */
export function noteCommandGuardChatAdopted(sessionId: string): void {
  const chat = chats.get(sessionId)
  if (chat) {
    chat.unconfirmed = true
  }
}

/** The hook of the newest launch works: Claude Code confirmed it. */
function confirm(sessionId: string): void {
  const chat = chats.get(sessionId)
  if (chat) {
    chat.unconfirmed = false
  }
}

/** The hook of the newest launch works: Claude Code called it. */
export function noteCommandGuardChatAnswers(sessionId: string, surface: GuardedChatSurface): void {
  if (!chats.has(sessionId)) {
    chats.set(sessionId, { surface, unconfirmed: false })
  }
  confirm(sessionId)
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
    confirm(sessionId)
  }
}

/**
 * The chats an agent's guard line is read from: those this host started and any other live one. A
 * chat that is not in the list is not known to this app.
 */
export function forkCommandGuardChatList(
  running: boolean,
  live: LiveGuardChats
): NonNullable<ForkCommandGuardsStatusResult['chats']> {
  const reasonOf = (unconfirmed: boolean): string | null =>
    running ? (unconfirmed ? UNCONFIRMED : null) : NOT_RUNNING
  const known = [...chats].map(([sessionId, { surface, unconfirmed }]) => {
    const reason = reasonOf(unconfirmed)
    return { sessionId, surface, guarded: reason === null, ...(reason ? { reason } : {}) }
  })
  const unknown = [...live]
    .filter(([sessionId]) => !chats.has(sessionId))
    .map(([sessionId, surface]) => ({
      sessionId,
      surface,
      guarded: false,
      reason: running ? COMMAND_GUARD_UNKNOWN_CHAT : NOT_RUNNING
    }))
  return [...known, ...unknown]
}

export function resetCommandGuardChats(): void {
  chats.clear()
}

const SURFACE_REASONS: Record<string, string> = {
  [NOT_RUNNING]: 'started without a guard attached',
  [UNCONFIRMED]: 'carried over an app restart, guard hook not confirmed by Claude Code yet',
  [COMMAND_GUARD_UNKNOWN_CHAT]: 'not known to this app'
}

function unguardedNote(reasons: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const reason of reasons) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  const parts = [...counts].map(
    ([reason, count]) =>
      `${count} chat${count === 1 ? '' : 's'} ${SURFACE_REASONS[reason] ?? reason}`
  )
  return `unguarded: ${parts.join('; ')}`
}

/** The per-surface coverage of this host's live chats: any one without a guard makes its surface unguarded. */
export function forkCommandGuardChatSurfaces(
  running: boolean,
  live: LiveGuardChats
): CommandGuardSurfaceCoverage[] {
  const list = forkCommandGuardChatList(running, live).filter((chat) => live.has(chat.sessionId))
  return commandGuardSurfaceCoverage().map((row) => {
    if (row.surface === 'terminal') {
      return row
    }
    const mine = list.filter((chat) => chat.surface === row.surface)
    const unguarded = mine.filter((chat) => !chat.guarded)
    return {
      ...row,
      guarded: row.guarded && unguarded.length === 0,
      note:
        row.guarded && unguarded.length > 0
          ? unguardedNote(unguarded.map((chat) => chat.reason ?? ''))
          : row.note,
      chats: { guarded: mine.length - unguarded.length, unguarded: unguarded.length }
    }
  })
}
