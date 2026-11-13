// SLRM-2104 (FORK.md "Usage and cost report"): rolls the usage ledger up by chat, coordinator,
// workspace, day or card, and prices it. Pure: the clock, day key and prices are passed in.
import {
  estimateCostUsd,
  MODEL_PRICING,
  normalizeModelForPricing
} from '../../claude-usage/claude-model-pricing'
import { FORK_USAGE_NO_TOKENS, type ForkUsagePrice } from '../../../shared/fork/usage-ledger'
import type {
  ForkUsageReport,
  ForkUsageReportGroup,
  ForkUsageReportRow
} from '../../../shared/fork/usage-report'
import {
  addTokens,
  localDayKey,
  totalTokens,
  UNKNOWN_MODEL,
  type UsageCell,
  type UsageChatRecord,
  type UsageLedgerData
} from './usage-ledger-model'

/** Estimated USD of one model's tokens, or null when the model has no price. */
export type UsagePricer = (model: string, cell: UsageCell['tokens']) => number | null

const PRICE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h'] as const

/** The built-in price table (the app's own Claude prices), USD per million tokens. */
export function defaultUsagePrices(): Record<string, ForkUsagePrice> {
  return Object.fromEntries(
    Object.entries(MODEL_PRICING).map(([model, rates]) => [
      model,
      {
        input: rates.input,
        output: rates.output,
        cacheRead: rates.cacheRead,
        cacheWrite: rates.cacheWrite,
        cacheWrite1h: rates.cacheWrite1h
      }
    ])
  )
}

/** The user's overrides, keeping only rows whose rates are all finite and not negative. */
export function cleanUsagePrices(value: unknown): Record<string, ForkUsagePrice> {
  const clean: Record<string, ForkUsagePrice> = {}
  if (typeof value !== 'object' || value === null) {
    return clean
  }
  for (const [model, raw] of Object.entries(value as Record<string, unknown>)) {
    const rates = raw as Record<string, unknown> | null
    const ok = (field: string): boolean =>
      typeof rates?.[field] === 'number' && Number.isFinite(rates[field]) && rates[field] >= 0
    if (model.trim() && rates && ['input', 'output', 'cacheRead', 'cacheWrite'].every(ok)) {
      const price = Object.fromEntries(
        PRICE_FIELDS.filter(ok).map((field) => [field, rates[field] as number])
      )
      clean[model.trim()] = price as ForkUsagePrice
    }
  }
  return clean
}

function priceWith(rates: ForkUsagePrice, tokens: UsageCell['tokens']): number {
  const write1h = Math.min(tokens.cacheWrite1hTokens, tokens.cacheWriteTokens)
  return (
    (tokens.inputTokens * rates.input +
      tokens.outputTokens * rates.output +
      tokens.cacheReadTokens * rates.cacheRead +
      (tokens.cacheWriteTokens - write1h) * rates.cacheWrite +
      write1h * (rates.cacheWrite1h ?? rates.cacheWrite)) /
    1_000_000
  )
}

/**
 * A user row for the exact model id or its family key wins and is applied flat (no long-context
 * premium); otherwise the built-in table prices it, long-context rates included.
 */
export function usagePricer(overrides: Record<string, ForkUsagePrice>): UsagePricer {
  return (model, tokens) => {
    if (model === UNKNOWN_MODEL) {
      return null
    }
    const own = overrides[model] ?? overrides[normalizeModelForPricing(model) ?? '']
    return own ? priceWith(own, tokens) : estimateCostUsd(model, tokens)
  }
}

export type CardMatcher = { card: (name: string | undefined) => string | undefined; error?: string }

/** Group 1 of the user's pattern, or the whole match, names the card. Empty matches nothing. */
export function cardMatcher(pattern: string | undefined): CardMatcher {
  const source = pattern?.trim()
  if (!source) {
    return { card: () => undefined }
  }
  let regex: RegExp
  try {
    regex = new RegExp(source, 'i')
  } catch (error) {
    return { card: () => undefined, error: error instanceof Error ? error.message : String(error) }
  }
  return {
    card: (name) => {
      const match = name ? regex.exec(name) : null
      return (match?.[1] ?? match?.[0])?.trim() || undefined
    }
  }
}

export type UsageReportOptions = {
  by: ForkUsageReportGroup
  days?: number
  now: number
  pricer: UsagePricer
  cardPattern?: string
  dayKey?: (ms: number) => string
}

type Bucket = ForkUsageReportRow & { chatIds: Set<string> }

function emptyBucket(key: string, label: string): Bucket {
  const { longContext: _drop, ...tokens } = FORK_USAGE_NO_TOKENS
  return {
    key,
    label,
    chats: 0,
    calls: 0,
    tokens,
    totalTokens: 0,
    costUsd: null,
    subscriptionTokens: 0,
    unpricedTokens: 0,
    lastAt: 0,
    chatIds: new Set()
  }
}

function addCell(
  bucket: Bucket,
  chat: UsageChatRecord,
  model: string,
  cell: UsageCell,
  pricer: UsagePricer
): void {
  const { longContext: _drop, ...tokens } = addTokens(bucket.tokens, cell.tokens)
  const count = totalTokens(cell.tokens)
  bucket.tokens = tokens
  bucket.totalTokens += count
  bucket.calls += cell.calls
  bucket.chatIds.add(chat.sessionId)
  bucket.lastAt = Math.max(bucket.lastAt, chat.lastAt)
  if (chat.billing === 'subscription') {
    bucket.subscriptionTokens += count
    return
  }
  const cost = pricer(model, cell.tokens)
  if (cost === null) {
    bucket.unpricedTokens += count
  } else {
    bucket.costUsd = (bucket.costUsd ?? 0) + cost
  }
}

const shortId = (sessionId: string): string => sessionId.slice(0, 8)

function chatLabel(chat: UsageChatRecord | undefined, sessionId: string): string {
  return chat?.title ?? `Chat ${shortId(sessionId)}`
}

/** The chat at the top of the dispatch chain: the coordinator of its workers. */
function coordinatorOf(data: UsageLedgerData, chat: UsageChatRecord): string {
  let id = chat.sessionId
  const seen = new Set([id])
  let parent = chat.parentSessionId
  while (parent && !seen.has(parent)) {
    seen.add(parent)
    id = parent
    parent = data.chats[parent]?.parentSessionId
  }
  return id
}

type Grouping = { key: string; label: string; detail?: string }

function groupOf(
  data: UsageLedgerData,
  chat: UsageChatRecord,
  day: string,
  by: ForkUsageReportGroup,
  cards: CardMatcher
): Grouping {
  switch (by) {
    case 'chat':
      return {
        key: chat.sessionId,
        label: chatLabel(chat, chat.sessionId),
        ...(chat.workspaceName ? { detail: chat.workspaceName } : {})
      }
    case 'coordinator': {
      const root = coordinatorOf(data, chat)
      return { key: root, label: chatLabel(data.chats[root], root) }
    }
    case 'workspace': {
      const key = chat.workspaceId ?? ''
      return { key, label: chat.workspaceName ?? (key ? key : '(no workspace)') }
    }
    case 'day':
      return { key: day, label: day }
    case 'card': {
      const card = cards.card(chat.workspaceName)
      return { key: card ?? '', label: card ?? '(no card)' }
    }
  }
}

function finish(bucket: Bucket): ForkUsageReportRow {
  const { chatIds, ...row } = bucket
  return { ...row, chats: chatIds.size }
}

export function buildUsageReport(
  data: UsageLedgerData,
  options: UsageReportOptions
): ForkUsageReport {
  const dayKey = options.dayKey ?? localDayKey
  const since = options.days ? dayKey(options.now - (options.days - 1) * 86_400_000) : undefined
  const cards = cardMatcher(options.by === 'card' ? options.cardPattern : undefined)
  const buckets = new Map<string, Bucket>()
  const total = emptyBucket('total', 'Total')
  for (const chat of Object.values(data.chats)) {
    for (const [day, models] of Object.entries(chat.days)) {
      if (since && day < since) {
        continue
      }
      const group = groupOf(data, chat, day, options.by, cards)
      let bucket = buckets.get(group.key)
      if (!bucket) {
        bucket = emptyBucket(group.key, group.label)
        if (group.detail) {
          bucket.detail = group.detail
        }
        buckets.set(group.key, bucket)
      }
      for (const [model, cell] of Object.entries(models)) {
        addCell(bucket, chat, model, cell, options.pricer)
        addCell(total, chat, model, cell, options.pricer)
      }
    }
  }
  const rows = [...buckets.values()].map(finish)
  if (options.by === 'coordinator') {
    for (const row of rows.filter((entry) => entry.chats > 1)) {
      row.detail = `${row.chats} chats`
    }
  }
  rows.sort((left, right) =>
    options.by === 'day'
      ? right.key.localeCompare(left.key)
      : (right.costUsd ?? 0) - (left.costUsd ?? 0) || right.totalTokens - left.totalTokens
  )
  return {
    by: options.by,
    days: options.days ?? null,
    generatedAt: options.now,
    rows,
    total: finish(total),
    ...(cards.error ? { cardPatternError: cards.error } : {})
  }
}
