// Letters (FORK.md, SLRM-2389): who sends and who receives, read from this host's own agent rows
// (the rows Sleepers lists). A sender is the chat whose environment ran the command: a native
// chat's session id or a terminal agent's pane key, each checked against this host's chats. A
// command run outside any agent is "shell". Ids identify same-user callers, not credentials: the
// rate limit and the untrusted frame are the guard, not this check.
import type { SleeperSource } from '../../../shared/fork/sleepers'
import type { ForkLetterParty } from '../../../shared/fork/letters'
import type { ForkLetterCallerClaim, ForkLetterChat } from '../../../shared/fork/letters-wire'

/** The chats on this host a letter can reach: local agents, their own rows, not sub-agents. */
export function forkLetterChatsFromSources(sources: readonly SleeperSource[]): ForkLetterChat[] {
  return sources
    .filter((source) => source.local)
    .map((source) => ({
      id: source.id,
      kind: source.kind,
      title: source.title,
      agent: source.agent ?? '',
      workspace: source.workspace,
      worktreeId: source.worktreeId
    }))
}

export function forkLetterPartyOf(chat: ForkLetterChat): ForkLetterParty {
  return {
    chatId: chat.id,
    kind: chat.kind,
    title: chat.title.slice(0, 200),
    agent: chat.agent.slice(0, 100),
    worktreeId: chat.worktreeId,
    host: null
  }
}

export const FORK_LETTER_SHELL_PARTY: ForkLetterParty = {
  chatId: 'shell',
  kind: 'shell',
  title: 'shell',
  agent: '',
  worktreeId: null,
  host: null
}

/**
 * The sending chat. A session id this host does not hold is refused, so a letter never claims a
 * chat that is not here; a pane key that is no agent's (a plain shell tab) is the shell.
 */
export function resolveForkLetterCaller(
  claim: ForkLetterCallerClaim,
  chats: readonly ForkLetterChat[],
  hasChatRecord: (sessionId: string) => boolean
): ForkLetterParty {
  if (claim?.sessionId) {
    const chat = chats.find((c) => c.kind === 'chat' && c.id === claim.sessionId)
    if (chat) {
      return forkLetterPartyOf(chat)
    }
    if (!hasChatRecord(claim.sessionId)) {
      throw new Error(
        'This command ran in a chat this Orca host does not know, so it cannot sign the letter.'
      )
    }
    return { ...FORK_LETTER_SHELL_PARTY, chatId: claim.sessionId, kind: 'chat', title: '' }
  }
  if (claim?.paneKey) {
    const chat = chats.find((c) => c.kind === 'terminal' && c.id === claim.paneKey)
    if (chat) {
      return forkLetterPartyOf(chat)
    }
  }
  return FORK_LETTER_SHELL_PARTY
}

/** The receiving chat: an exact id or pane key, or a unique prefix of 4+ characters. */
export function resolveForkLetterRecipient(
  query: string,
  chats: readonly ForkLetterChat[]
): ForkLetterChat {
  const exact = chats.filter((chat) => chat.id === query)
  const matches =
    exact.length > 0
      ? exact
      : query.length >= 4
        ? chats.filter((chat) => chat.id.startsWith(query))
        : []
  if (matches.length === 1) {
    return matches[0]
  }
  throw new Error(
    matches.length === 0
      ? `No chat on this host matches "${query}". Run "orca letter chats" for ids.`
      : `"${query}" matches ${matches.length} chats; use more of its id.`
  )
}
