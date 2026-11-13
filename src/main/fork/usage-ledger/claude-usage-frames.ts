// SLRM-2103 (FORK.md "Usage ledger and cache-cold cue"): what one Claude stream-json frame says
// about usage. Assistant frames carry per-call usage keyed by the API message id (one call can
// span several frames, the same id each time), so the ledger counts calls, not result totals.
import type { ForkCacheTtl, ForkUsageBilling } from '../../../shared/fork/usage-ledger'

export type ClaudeCallUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheWrite1hTokens: number
}

export type ClaudeUsageObservation =
  | {
      kind: 'call'
      /** The API message id: frames of one call share it. */
      callId: string
      model: string | null
      usage: ClaudeCallUsage
      /** The main thread's call (sizes the context); false for a sub-agent's. */
      root: boolean
      ttl?: ForkCacheTtl
    }
  | { kind: 'turn-end' }
  | { kind: 'init'; billing: ForkUsageBilling | null }
  | { kind: 'context-reset' }

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

function isRoot(frame: Record<string, unknown>): boolean {
  return typeof frame.parent_tool_use_id !== 'string'
}

function ttlOf(creation: Record<string, unknown> | null): ForkCacheTtl | undefined {
  if (count(creation?.ephemeral_1h_input_tokens) > 0) {
    return '1h'
  }
  return count(creation?.ephemeral_5m_input_tokens) > 0 ? '5m' : undefined
}

/**
 * Billing from init's apiKeySource: 'none' means the CLI signed in with an account (a
 * subscription plan), any named key source means per-token API billing. Unknown stays null.
 */
function billingOf(source: unknown): ForkUsageBilling | null {
  if (source === 'none') {
    return 'subscription'
  }
  return typeof source === 'string' && source.length > 0 ? 'api' : null
}

export function claudeUsageObservation(
  frame: Record<string, unknown>
): ClaudeUsageObservation | null {
  if (frame.type === 'assistant') {
    const message = record(frame.message)
    const usage = record(message?.usage)
    const callId = typeof message?.id === 'string' ? message.id : ''
    if (!message || !usage || !callId) {
      return null
    }
    const creation = record(usage.cache_creation)
    const cacheWriteTokens = count(usage.cache_creation_input_tokens)
    const parsed: ClaudeCallUsage = {
      inputTokens: count(usage.input_tokens),
      outputTokens: count(usage.output_tokens),
      cacheReadTokens: count(usage.cache_read_input_tokens),
      cacheWriteTokens,
      cacheWrite1hTokens: Math.min(cacheWriteTokens, count(creation?.ephemeral_1h_input_tokens))
    }
    if (Object.values(parsed).every((value) => value === 0)) {
      // Synthetic responses (errors, interrupts) report zero usage.
      return null
    }
    const model = typeof message.model === 'string' && message.model ? message.model : null
    const ttl = ttlOf(creation)
    return {
      kind: 'call',
      callId,
      model: model === '<synthetic>' ? null : model,
      usage: parsed,
      root: isRoot(frame),
      ...(ttl ? { ttl } : {})
    }
  }
  if (!isRoot(frame)) {
    return null
  }
  if (frame.type === 'result') {
    return { kind: 'turn-end' }
  }
  if (frame.type === 'system' && frame.subtype === 'init') {
    return { kind: 'init', billing: billingOf(frame.apiKeySource) }
  }
  if (
    (frame.type === 'system' && frame.subtype === 'compact_boundary') ||
    frame.type === 'conversation_reset'
  ) {
    return { kind: 'context-reset' }
  }
  return null
}

/** Tokens the next main-thread call re-reads: the whole prompt of the last one. */
export function claudeCallContextTokens(usage: ClaudeCallUsage): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}
