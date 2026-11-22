// BAD-679 (FORK.md "Spend caps for every agent"): what a terminal agent's transcript says about
// usage. Claude Code writes one JSON row per message with the API's usage; Codex writes running
// totals in `token_count` rows and names the model in `turn_context` rows. Only token counts, the
// model and the time are kept: no row's text is ever read out. Pure apart from the file read.
import { open } from 'node:fs/promises'
import { claudeUsageObservation, type ClaudeUsageObservation } from './claude-usage-frames'
import { FORK_USAGE_NO_TOKENS, type ForkUsageTokens } from '../../../shared/fork/usage-ledger'

/** Most bytes one read takes, so a huge transcript is caught up over several passes. */
export const TRANSCRIPT_READ_BYTES = 4 * 1024 * 1024

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseRow(line: string): Record<string, unknown> | null {
  if (!line.startsWith('{')) {
    return null
  }
  try {
    return record(JSON.parse(line))
  } catch {
    return null
  }
}

function timeOf(row: Record<string, unknown>): number | null {
  const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : Number.NaN
  return Number.isFinite(at) ? at : null
}

export type ClaudeTranscriptCall = {
  at: number | null
  call: Extract<ClaudeUsageObservation, { kind: 'call' }>
}

/** The provider call a Claude Code transcript row reports, or null for any other row. */
export function parseClaudeTranscriptRow(line: string): ClaudeTranscriptCall | null {
  const row = parseRow(line)
  if (!row || row.type !== 'assistant') {
    return null
  }
  const observation = claudeUsageObservation(row)
  return observation?.kind === 'call' ? { at: timeOf(row), call: observation } : null
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0

/**
 * Codex's running totals as the ledger keeps tokens: input without the cached part, the cached
 * part as cache reads (Codex counts cached tokens inside input), output as output.
 */
export function codexTotalsToLedgerTokens(raw: unknown): ForkUsageTokens | null {
  const usage = record(raw)
  if (!usage) {
    return null
  }
  const input = count(usage.input_tokens)
  const cached = Math.min(count(usage.cached_input_tokens ?? usage.cache_read_input_tokens), input)
  return {
    ...FORK_USAGE_NO_TOKENS,
    inputTokens: input - cached,
    cacheReadTokens: cached,
    outputTokens: count(usage.output_tokens)
  }
}

/** The thread's running totals from a Codex app-server `thread/tokenUsage/updated` frame. */
export function codexChatUsageTotals(params: unknown): ForkUsageTokens | null {
  const total = record(record(record(params)?.tokenUsage)?.total)
  if (!total) {
    return null
  }
  return codexTotalsToLedgerTokens({
    input_tokens: total.inputTokens,
    cached_input_tokens: total.cachedInputTokens,
    output_tokens: total.outputTokens
  })
}

const FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const

function growth(total: ForkUsageTokens, before: ForkUsageTokens | null): ForkUsageTokens {
  const reset = before !== null && FIELDS.some((field) => total[field] < before[field])
  const delta: ForkUsageTokens = { ...FORK_USAGE_NO_TOKENS }
  for (const field of FIELDS) {
    delta[field] = reset || !before ? total[field] : total[field] - before[field]
  }
  return delta
}

export type CodexRolloutGrowth = { model: string | null; delta: ForkUsageTokens }

/** Follows one Codex rollout row by row: the model in force and the totals so far. */
export class CodexRolloutReader {
  private model: string | null = null
  private totals: ForkUsageTokens | null = null

  /**
   * The tokens a row added, or null when it adds none or is not a usage row. Rows older than
   * `notBefore` only move the baseline: what was spent before then is not counted.
   */
  row(line: string, notBefore: number): CodexRolloutGrowth | null {
    const row = parseRow(line)
    const payload = record(row?.payload)
    if (!row || !payload) {
      return null
    }
    if (row.type === 'turn_context') {
      const model = typeof payload.model === 'string' ? payload.model.trim() : ''
      this.model = model || this.model
      return null
    }
    if (row.type !== 'event_msg' || payload.type !== 'token_count') {
      return null
    }
    const total = codexTotalsToLedgerTokens(record(payload.info)?.total_token_usage)
    if (!total) {
      // Rate-limit updates carry a token_count row with no usage.
      return null
    }
    const delta = growth(total, this.totals)
    this.totals = total
    const at = timeOf(row)
    if (at !== null && at < notBefore) {
      return null
    }
    return FIELDS.some((field) => delta[field] > 0) ? { model: this.model, delta } : null
  }
}

export type TranscriptChunk = { lines: string[]; offset: number }

/**
 * The whole rows written after `offset` (up to the read limit); the offset returned is just past
 * the last newline, so a row still being written is read again next time. A file that shrank
 * starts over. A missing or unreadable file yields no lines and the same offset.
 */
export async function readTranscriptRows(path: string, offset: number): Promise<TranscriptChunk> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(path, 'r')
    const { size } = await handle.stat()
    const from = size < offset ? 0 : offset
    const length = Math.min(size - from, TRANSCRIPT_READ_BYTES)
    if (length <= 0) {
      return { lines: [], offset: from }
    }
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, from)
    const text = buffer.subarray(0, bytesRead)
    const end = text.lastIndexOf(0x0a)
    if (end === -1) {
      // One row longer than the whole read can never complete: step over it.
      return { lines: [], offset: length >= TRANSCRIPT_READ_BYTES ? from + length : from }
    }
    return {
      lines: text.subarray(0, end).toString('utf8').split('\n'),
      offset: from + end + 1
    }
  } catch {
    return { lines: [], offset }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
