// SLRM-1473: a letter another agent sends into a Claude session lands in Claude's transcript as an
// ordinary user line, indistinguishable from the person's own words. Each one Claude takes is
// recorded here so transcript readers (convo-store) can mark it. A row never holds the letter text:
// only the Claude session id, the prompt uuid Orca gave it, the time, and a sha256 of the text.
import { createHash } from 'node:crypto'
import { appendFile, chmod, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Overrides the ledger path; tests point it at a temp file. */
export const AGENT_LETTER_LEDGER_ENV = 'ORCA_AGENT_LETTER_LEDGER'

export type AgentLetterLedgerRow = {
  v: 1
  /** Milliseconds since the epoch at the moment Claude took the message. */
  at: number
  agent: 'claude'
  /** Claude's own session id: the `sessionId` its transcript lines carry. */
  session: string
  /** The uuid Orca sent the prompt under; Claude's transcript line keeps it. */
  uuid: string
  /** sha256 hex of normalizeAgentLetterText(text). */
  sha256: string
}

type LedgerEnv = Record<string, string | undefined>

/** Null under vitest without an override, so no test can reach the person's real ledger. */
export function agentLetterLedgerPath(env: LedgerEnv = process.env): string | null {
  const override = env[AGENT_LETTER_LEDGER_ENV]?.trim()
  if (override) {
    return override
  }
  if (env.VITEST) {
    return null
  }
  const stateHome = env.XDG_STATE_HOME?.trim() || join(homedir(), '.local', 'state')
  return join(stateHome, 'orca', 'agent-letters.jsonl')
}

/** Both sides hash the same form: CRLF and lone CR become LF, then outer whitespace is trimmed.
 *  Claude stores the prompt it was sent, but readers should not depend on edge whitespace. */
export function normalizeAgentLetterText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim()
}

export function agentLetterTextHash(text: string): string {
  return createHash('sha256').update(normalizeAgentLetterText(text), 'utf8').digest('hex')
}

/** The text Claude records as the user message: its text blocks, joined the way it joins them. */
export function claudeContentText(content: readonly unknown[]): string {
  return content
    .map((part) =>
      part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
        ? (part as { text?: unknown }).text
        : undefined
    )
    .filter((text): text is string => typeof text === 'string')
    .join('\n')
}

export function agentLetterLedgerRow(input: {
  session: string
  uuid: string
  text: string
  at?: number
}): AgentLetterLedgerRow {
  return {
    v: 1,
    at: input.at ?? Date.now(),
    agent: 'claude',
    session: input.session,
    uuid: input.uuid,
    sha256: agentLetterTextHash(input.text)
  }
}

/** Append-only, mode 600 in a 700 folder. A failure is logged and never touches delivery. */
export async function appendAgentLetterLedgerRow(
  row: AgentLetterLedgerRow,
  path: string | null = agentLetterLedgerPath()
): Promise<void> {
  if (!path) {
    return
  }
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await appendFile(path, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'a' })
    // The mode above applies only on creation; keep an existing file private too.
    await chmod(path, 0o600)
  } catch (error) {
    console.warn('[agent-letter-ledger] could not record a letter:', error)
  }
}
