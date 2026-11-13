// Test fixtures: Claude stream-json frames shaped like the CLI's, with made-up ids and counts.

export function assistantFrame(options: {
  id: string
  model?: string
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  cacheWrite1h?: number
  parentToolUseId?: string
}): Record<string, unknown> {
  const cacheWrite = options.cacheWrite ?? 0
  const write1h = options.cacheWrite1h ?? 0
  return {
    type: 'assistant',
    ...(options.parentToolUseId ? { parent_tool_use_id: options.parentToolUseId } : {}),
    message: {
      id: options.id,
      type: 'message',
      role: 'assistant',
      model: options.model ?? 'claude-sonnet-4-5',
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: options.input ?? 0,
        output_tokens: options.output ?? 0,
        cache_read_input_tokens: options.cacheRead ?? 0,
        cache_creation_input_tokens: cacheWrite,
        cache_creation: {
          ephemeral_5m_input_tokens: cacheWrite - write1h,
          ephemeral_1h_input_tokens: write1h
        }
      }
    }
  }
}

export const RESULT_FRAME = { type: 'result', subtype: 'success', is_error: false }

export function initFrame(apiKeySource: string): Record<string, unknown> {
  return { type: 'system', subtype: 'init', apiKeySource, model: 'claude-sonnet-4-5' }
}

export const COMPACT_FRAME = { type: 'system', subtype: 'compact_boundary' }

/** A clock tests move by hand. */
export function fakeClock(start = Date.UTC(2026, 0, 15, 12, 0, 0)): {
  now: () => number
  advance: (ms: number) => void
} {
  let current = start
  return {
    now: () => current,
    advance: (ms) => {
      current += ms
    }
  }
}

/** UTC day keys, so tests do not depend on the machine's time zone. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
