// SLRM-1503: what the chip asks hosts, read once per host or chat and shared by every chip.
// No polling: a host is read on first use and again when a hover opens or its roster changes.
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'
import type { RateLimitState } from '../../../../shared/rate-limit-types'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import {
  FORK_CLAUDE_CHAT_HOME_METHOD,
  type ForkClaudeChatHome
} from '../../../../shared/fork/claude-account-chip'
import { fetchProviderAccountsSnapshot } from '@/runtime/runtime-provider-accounts-client'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'

export type ClaudeHostSnapshot = {
  claude: ClaudeRateLimitAccountsState
  /** Remote hosts only; this desktop's usage is in the app store. */
  rateLimits: RateLimitState | null
}

export type ChatHomeEntry = ForkClaudeChatHome | 'loading' | 'failed'

type Reader = {
  readHost: (target: RuntimeClientTarget) => Promise<ClaudeHostSnapshot>
  readChatHome: (target: RuntimeClientTarget, sessionId: string) => Promise<ForkClaudeChatHome>
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
  readChatHome: (target, sessionId) =>
    callStructuredAgentSession<ForkClaudeChatHome>(target, FORK_CLAUDE_CHAT_HOME_METHOD, {
      sessionId
    })
}

let reader = defaultReader
const hosts = new Map<string, ClaudeHostSnapshot>()
const hostReads = new Map<string, Promise<void>>()
const chatHomes = new Map<string, ChatHomeEntry>()
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

export function getChatHome(target: RuntimeClientTarget, sessionId: string): ChatHomeEntry {
  return chatHomes.get(`${transportKey(target)}|${sessionId}`) ?? 'loading'
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

/** Reads which home a chat runs on; `force` reads again, e.g. after its account moved. */
export function loadChatHome(
  target: RuntimeClientTarget,
  sessionId: string,
  force = false
): Promise<void> {
  const key = `${transportKey(target)}|${sessionId}`
  const current = chatHomes.get(key)
  if (current === 'loading' || (current && !force)) {
    return Promise.resolve()
  }
  if (!current) {
    chatHomes.set(key, 'loading')
  }
  return reader.readChatHome(target, sessionId).then(
    (home) => {
      chatHomes.set(key, home)
      notify()
    },
    // An older host without the fork method, or a chat it no longer holds.
    () => {
      chatHomes.set(key, 'failed')
      notify()
    }
  )
}

/** For the account-move menu: the chat's next read names its new account. */
export function invalidateForkClaudeChatHome(target: RuntimeClientTarget, sessionId: string): void {
  void loadChatHome(target, sessionId, true)
}

/** Tests only: swap the host reads and drop every cached answer. */
export function resetClaudeChipCacheForTests(next: Partial<Reader> = {}): void {
  reader = { ...defaultReader, ...next }
  hosts.clear()
  hostReads.clear()
  chatHomes.clear()
  notify()
}
