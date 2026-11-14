// Idle recovery (FORK.md), item B: the end of a terminal agent's conversation, read from the
// tail of the transcript file its hooks reported. At most `IDLE_RECOVERY_TRANSCRIPT_TAIL_BYTES`
// are read however large the file is, and the file is only ever opened for reading.
import { open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

export const IDLE_RECOVERY_TRANSCRIPT_TAIL_BYTES = 512 * 1024

export type TranscriptMessage = { role: 'user' | 'assistant'; text: string }

export type TranscriptEnding = {
  /** Null when the request scrolled out of the part of the file that was read. */
  lastUserRequest: string | null
  lastAssistantMessage: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const TEXT_BLOCK_TYPES: readonly unknown[] = ['text', 'input_text', 'output_text']

function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  const parts: string[] = []
  for (const block of content) {
    if (
      isRecord(block) &&
      TEXT_BLOCK_TYPES.includes(block.type) &&
      typeof block.text === 'string'
    ) {
      parts.push(block.text)
    }
  }
  return parts.join('\n')
}

/**
 * One transcript line as a message, or null for anything else (tool calls and results, side
 * chains, metadata, a cut or foreign line). Reads the line shapes of the JSONL transcripts
 * agents write: an entry with a `message`, an entry with a `payload` message, or a bare message.
 */
export function readTranscriptLine(line: string): TranscriptMessage | null {
  let entry: unknown
  try {
    entry = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(entry) || entry.isSidechain === true || entry.isMeta === true) {
    return null
  }
  let message: unknown = entry
  if (isRecord(entry.message)) {
    message = entry.message
  } else if (isRecord(entry.payload)) {
    if (entry.payload.type !== 'message') {
      return null
    }
    message = entry.payload
  }
  if (!isRecord(message)) {
    return null
  }
  const role = message.role
  if (role !== 'user' && role !== 'assistant') {
    return null
  }
  const text = textOf(message.content).trim()
  return text ? { role, text } : null
}

/** The last assistant message and the request before it, or null when no assistant text is found. */
export function transcriptEndingFromLines(lines: readonly string[]): TranscriptEnding | null {
  let assistant: string | null = null
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (!line) {
      continue
    }
    const message = readTranscriptLine(line)
    if (!message) {
      continue
    }
    if (message.role === 'assistant') {
      assistant ??= message.text
    } else if (assistant === null) {
      // The newest message is the user's: the agent has not answered it in this file yet.
      return null
    } else {
      return { lastUserRequest: message.text, lastAssistantMessage: assistant }
    }
  }
  return assistant === null ? null : { lastUserRequest: null, lastAssistantMessage: assistant }
}

/** Null for a path that is not a local absolute `.jsonl` file, or that cannot be read. */
export async function readTranscriptEnding(
  path: string,
  maxBytes = IDLE_RECOVERY_TRANSCRIPT_TAIL_BYTES
): Promise<TranscriptEnding | null> {
  if (!isAbsolute(path) || !path.toLowerCase().endsWith('.jsonl')) {
    return null
  }
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(path, 'r')
    const { size } = await handle.stat()
    const length = Math.min(size, Math.max(1, maxBytes))
    const start = size - length
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, start)
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n')
    if (start > 0) {
      // The read began mid-line: the first piece is not a whole entry.
      lines.shift()
    }
    return transcriptEndingFromLines(lines)
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
