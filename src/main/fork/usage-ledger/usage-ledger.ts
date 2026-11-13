// SLRM-2103 (FORK.md "Usage ledger and cache-cold cue"): the in-memory ledger. Pure: the clock,
// day key and long-context rule are injected, so tests drive it with fixture frames and a fake
// clock. The service owns persistence and the hooks.
import type { ForkCacheState, ForkUsageTokens } from '../../../shared/fork/usage-ledger'
import { claudeCallContextTokens, type ClaudeUsageObservation } from './claude-usage-frames'
import {
  addTokens,
  emptyLedgerData,
  localDayKey,
  readTokens,
  RECENT_CALLS_KEPT,
  UNKNOWN_MODEL,
  type UsageChatRecord,
  type UsageLedgerData
} from './usage-ledger-model'

export type UsageLedgerDeps = {
  now: () => number
  dayKey?: (ms: number) => string
  /** True when a whole call of this model is billed at its long-context rates. */
  isLongContext?: (model: string | null, call: ForkUsageTokens) => boolean
}

export type UsageChatMeta = Partial<
  Pick<UsageChatRecord, 'agent' | 'title' | 'workspaceId' | 'workspaceName' | 'parentSessionId'>
>

export const USAGE_LEDGER_MAX_CHATS = 2000

const TOKEN_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'cacheWrite1hTokens'
] as const

export class UsageLedger {
  private data: UsageLedgerData
  /** Chats with a turn running; not saved, a restart starts with none. */
  private readonly working = new Set<string>()
  private readonly dayKey: (ms: number) => string

  constructor(
    private readonly deps: UsageLedgerDeps,
    data: UsageLedgerData = emptyLedgerData()
  ) {
    this.data = data
    this.dayKey = deps.dayKey ?? localDayKey
  }

  private chat(sessionId: string): UsageChatRecord {
    let chat = this.data.chats[sessionId]
    if (!chat) {
      const now = this.deps.now()
      chat = {
        sessionId,
        agent: 'claude',
        firstAt: now,
        lastAt: now,
        turns: 0,
        days: {},
        contextTokens: 0,
        recentCalls: []
      }
      this.data.chats[sessionId] = chat
    }
    return chat
  }

  /** Applies one observation; true when the chat's cache state changed. */
  observe(sessionId: string, observation: ClaudeUsageObservation): boolean {
    const chat = this.chat(sessionId)
    switch (observation.kind) {
      case 'init':
        if (observation.billing) {
          chat.billing = observation.billing
        }
        return false
      case 'context-reset':
        chat.contextTokens = 0
        return true
      case 'turn-end':
        chat.turns += 1
        chat.lastAt = this.deps.now()
        this.working.delete(sessionId)
        return true
      case 'call':
        this.addCall(chat, observation)
        return true
    }
  }

  private addCall(
    chat: UsageChatRecord,
    call: Extract<ClaudeUsageObservation, { kind: 'call' }>
  ): void {
    const now = this.deps.now()
    const index = chat.recentCalls.findIndex(([id]) => id === call.callId)
    const before = index !== -1 ? chat.recentCalls[index][1] : readTokens(null)
    const highest = readTokens(null)
    const delta = readTokens(null)
    for (const field of TOKEN_FIELDS) {
      highest[field] = Math.max(before[field], call.usage[field])
      delta[field] = highest[field] - before[field]
    }
    if (index !== -1) {
      chat.recentCalls.splice(index, 1)
    }
    chat.recentCalls.push([call.callId, highest])
    if (chat.recentCalls.length > RECENT_CALLS_KEPT) {
      chat.recentCalls.splice(0, chat.recentCalls.length - RECENT_CALLS_KEPT)
    }
    if (this.deps.isLongContext?.(call.model, highest)) {
      const { longContext: _drop, ...flat } = delta
      delta.longContext = flat
    }
    if (TOKEN_FIELDS.some((field) => delta[field] > 0)) {
      const day = (chat.days[this.dayKey(now)] ??= {})
      const model = call.model ?? UNKNOWN_MODEL
      const cell = day[model]
      day[model] = {
        tokens: cell ? addTokens(cell.tokens, delta) : delta,
        calls: (cell?.calls ?? 0) + (index !== -1 ? 0 : 1)
      }
    }
    chat.lastAt = now
    if (call.root) {
      chat.contextTokens = claudeCallContextTokens(highest)
      this.working.add(chat.sessionId)
      if (call.ttl) {
        chat.ttl = call.ttl
      }
    }
  }

  /** A turn opened (the user sent, or a queued send started). */
  noteTurnStart(sessionId: string): void {
    if (this.data.chats[sessionId]) {
      this.working.add(sessionId)
    }
  }

  /** The provider process ended; whatever turn it ran is over. */
  noteEnded(sessionId: string): boolean {
    return this.working.delete(sessionId)
  }

  noteMeta(sessionId: string, meta: UsageChatMeta): void {
    const chat = this.data.chats[sessionId]
    if (!chat) {
      return
    }
    for (const [key, value] of Object.entries(meta) as [keyof UsageChatMeta, string][]) {
      if (typeof value === 'string' && value.length > 0) {
        chat[key] = value
      }
    }
  }

  has(sessionId: string): boolean {
    return sessionId in this.data.chats
  }

  cacheStates(): ForkCacheState[] {
    return Object.values(this.data.chats)
      .filter((chat) => chat.contextTokens > 0)
      .map((chat) => ({
        sessionId: chat.sessionId,
        lastAt: chat.lastAt,
        contextTokens: chat.contextTokens,
        ...(chat.ttl ? { ttl: chat.ttl } : {}),
        working: this.working.has(chat.sessionId)
      }))
  }

  /** Drops days older than the retention, chats left with none, then the oldest past the cap. */
  prune(retentionDays: number, maxChats = USAGE_LEDGER_MAX_CHATS): boolean {
    const cutoffMs = this.deps.now() - retentionDays * 86_400_000
    const cutoffDay = this.dayKey(cutoffMs)
    let changed = false
    for (const [sessionId, chat] of Object.entries(this.data.chats)) {
      for (const day of Object.keys(chat.days)) {
        if (day < cutoffDay) {
          delete chat.days[day]
          changed = true
        }
      }
      if (Object.keys(chat.days).length === 0 && chat.lastAt < cutoffMs) {
        delete this.data.chats[sessionId]
        changed = true
      }
    }
    const chats = Object.values(this.data.chats)
    if (chats.length > maxChats) {
      chats.sort((left, right) => left.lastAt - right.lastAt)
      for (const chat of chats.slice(0, chats.length - maxChats)) {
        delete this.data.chats[chat.sessionId]
      }
      changed = true
    }
    return changed
  }

  clear(): void {
    this.data = emptyLedgerData()
    this.working.clear()
  }

  /** The live data; callers serialize or read it and never mutate it. */
  snapshot(): UsageLedgerData {
    return this.data
  }
}
