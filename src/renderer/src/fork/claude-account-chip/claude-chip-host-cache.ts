// SLRM-1503: what the chip asks hosts, read once per host or chat and shared by every chip.
// No polling: a host is read on first use and again when a hover opens or its roster changes.
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'
import type { RateLimitState } from '../../../../shared/rate-limit-types'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { ForkClaudeLaunchHome } from '../../../../shared/fork/claude-account-move'
import { fetchProviderAccountsSnapshot } from '@/runtime/runtime-provider-accounts-client'
import {
  onForkClaudeAccountMoved,
  readClaudeChatAccounts
} from '../claude-account-move/claude-account-move-client'

export type ClaudeHostSnapshot = {
  claude: ClaudeRateLimitAccountsState
  /** Remote hosts only; this desktop's usage is in the app store. */
  rateLimits: RateLimitState | null
}

/**
 * What a chat's host says about its account (`fork.claudeAccount.which`). `pin` is set once the
 * chat was moved (null is System default); `pending` while that move waits for a turn to end.
 */
export type ForkClaudeChatAccount = ForkClaudeLaunchHome & {
  pin?: string | null
  pending?: true
}

export type ChatHomeEntry = ForkClaudeChatAccount | 'loading' | 'failed'

type Reader = {
  readHost: (target: RuntimeClientTarget) => Promise<ClaudeHostSnapshot>
  readChatHome: (target: RuntimeClientTarget, sessionId: string) => Promise<ForkClaudeChatAccount>
}

const NOT_A_CLAUDE_CHAT: ForkClaudeChatAccount = { home: null, accountId: null }

async function readChatAccount(
  target: RuntimeClientTarget,
  sessionId: string
): Promise<ForkClaudeChatAccount> {
  const { sessions } = await readClaudeChatAccounts(target, { sessionId })
  const session = sessions.find((entry) => entry.sessionId === sessionId)
  if (!session) {
    return NOT_A_CLAUDE_CHAT
  }
  return {
    ...session.launch,
    ...(session.pinned ? { pin: session.accountId } : {}),
    ...(session.pending ? { pending: true } : {})
  }
}

const defaultReader: Reader = {
  readHost: async (target) => {
    if (target.kind === 'local') {
      // Only Claude: the shared snapshot would also read every Codex account.
      return {
        claude: await window.api.claudeAccounts.list(),
        rateLimits: null
      }
    }
    const snapshot = await fetchProviderAccountsSnapshot(target)
    if (snapshot.failedProviders?.includes('claude')) {
      throw new Error('Claude accounts unavailable')
    }
    return { claude: snapshot.claude, rateLimits: snapshot.rateLimits }
  },
  readChatHome: readChatAccount
}

let reader = defaultReader
const hosts = new Map<string, ClaudeHostSnapshot>()
const hostReads = new Map<string, Promise<void>>()
const chatHomes = new Map<string, ChatHomeEntry>()
const chatReads = new Map<string, Promise<void>>()
/** Chats forced while a read was in flight: that read may predate the move, so read once more. */
const staleChatReads = new Set<string>()
/** The chat status a pending chat was last read at; a new status reads it again. */
const pendingReadAt = new Map<string, string>()
const listeners = new Set<() => void>()
let version = 0

function notify(): void {
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

export function transportKey(target: RuntimeClientTarget): string {
  return target.kind === 'local' ? 'local' : `environment:${target.environmentId}`
}

export function subscribeClaudeChipCache(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getClaudeChipCacheVersion(): number {
  return version
}

export function getClaudeHostSnapshot(target: RuntimeClientTarget): ClaudeHostSnapshot | undefined {
  return hosts.get(transportKey(target))
}

function chatKey(target: RuntimeClientTarget, sessionId: string): string {
  return `${transportKey(target)}|${sessionId}`
}

export function getChatHome(target: RuntimeClientTarget, sessionId: string): ChatHomeEntry {
  return chatHomes.get(chatKey(target, sessionId)) ?? 'loading'
}

/** Reads the host's accounts; `force` reads again even when an answer is cached. */
export function loadClaudeHost(target: RuntimeClientTarget, force = false): Promise<void> {
  const key = transportKey(target)
  const pending = hostReads.get(key)
  if (pending || (!force && hosts.has(key))) {
    return pending ?? Promise.resolve()
  }
  const read = reader
    .readHost(target)
    .then(
      (snapshot) => {
        hosts.set(key, snapshot)
        notify()
      },
      // A host that cannot answer keeps its last answer; the chip falls back to saved folders.
      () => undefined
    )
    .finally(() => hostReads.delete(key))
  hostReads.set(key, read)
  return read
}

/** Reads which account a chat runs on; `force` reads again, e.g. after its account moved. */
export function loadChatHome(
  target: RuntimeClientTarget,
  sessionId: string,
  force = false
): Promise<void> {
  const key = chatKey(target, sessionId)
  const inFlight = chatReads.get(key)
  const current = chatHomes.get(key)
  if (inFlight) {
    if (force) {
      staleChatReads.add(key)
    }
    return inFlight
  }
  if (current && !force) {
    return Promise.resolve()
  }
  if (!current) {
    chatHomes.set(key, 'loading')
  }
  // A forced read keeps the last answer on screen until the new one lands.
  const read = reader
    .readChatHome(target, sessionId)
    .then(
      (home) => {
        chatHomes.set(key, home)
      },
      // An older host without the fork method, or a chat it no longer holds. A failed re-read
      // keeps the last answer.
      () => {
        if (typeof chatHomes.get(key) !== 'object') {
          chatHomes.set(key, 'failed')
        }
      }
    )
    .finally(() => {
      chatReads.delete(key)
      if (staleChatReads.delete(key)) {
        void loadChatHome(target, sessionId, true)
      }
      notify()
    })
  chatReads.set(key, read)
  return read
}

/**
 * A queued move settles when the chat's turn ends, which no event reports, so a pending chat is
 * read again each time its status changes. Chats without a queued move are never re-read here.
 */
export function refreshPendingChatHome(
  target: RuntimeClientTarget,
  sessionId: string,
  status: string
): void {
  const key = chatKey(target, sessionId)
  const current = chatHomes.get(key)
  if (typeof current !== 'object' || !current.pending) {
    pendingReadAt.delete(key)
    return
  }
  const last = pendingReadAt.get(key)
  pendingReadAt.set(key, status)
  if (last !== undefined && last !== status) {
    void loadChatHome(target, sessionId, true)
  }
}

/** After a move: the chat's next read names its new account, or the move waiting on it. */
export function invalidateForkClaudeChatHome(target: RuntimeClientTarget, sessionId: string): void {
  void loadChatHome(target, sessionId, true)
}

onForkClaudeAccountMoved((target, results) => {
  for (const result of results) {
    invalidateForkClaudeChatHome(target, result.sessionId)
  }
})

/** Tests only: swap the host reads and drop every cached answer. */
export function resetClaudeChipCacheForTests(next: Partial<Reader> = {}): void {
  reader = { ...defaultReader, ...next }
  hosts.clear()
  hostReads.clear()
  chatHomes.clear()
  chatReads.clear()
  staleChatReads.clear()
  pendingReadAt.clear()
  notify()
}
