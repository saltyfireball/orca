import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentJournalMessageItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import type { AgentMessageSource } from '../../../shared/agent-session/agent-session-message-source'
import {
  AGENT_LETTER_LEDGER_ENV,
  agentLetterLedgerPath,
  agentLetterTextHash,
  claudeContentText,
  normalizeAgentLetterText
} from './claude-agent-letter-ledger'
import { dispatchClaudeTurn } from './claude-structured-dispatch'
import { sessionFor, userMessage } from './claude-structured-dispatch-test-support'

const FROM_AGENT: AgentMessageSource = {
  kind: 'agent',
  senders: [],
  orchestration: null
}

function letter(text: string): AgentJournalMessageItem {
  return { ...userMessage([{ type: 'text', text }]), from: FROM_AGENT }
}

const TOOK_AT = Date.UTC(2026, 10, 13, 12, 0, 0)

function rows(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) {
    return []
  }
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('agent letter ledger', () => {
  let dir: string
  let ledger: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-letter-ledger-'))
    ledger = join(dir, 'state', 'agent-letters.jsonl')
    vi.stubEnv(AGENT_LETTER_LEDGER_ENV, ledger)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  })

  /** A later letter on a working session lands after any row the earlier dispatch started, so
   *  seeing the ledger hold only that letter proves the earlier one wrote nothing. */
  async function expectOnlySentinelRow(): Promise<void> {
    await dispatchClaudeTurn(sessionFor(), { body: letter('sentinel'), sentUuid: 'uuid-sentinel' })
    await vi.waitFor(() => expect(rows(ledger).map((row) => row.uuid)).toContain('uuid-sentinel'))
    expect(rows(ledger).map((row) => row.uuid)).toEqual(['uuid-sentinel'])
  }

  it('records a letter Claude took: session, uuid, time and hash, never the text', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const session = sessionFor(send)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TOOK_AT)
    const outcome = await dispatchClaudeTurn(session, {
      body: letter('Please review PR 12\r\nthen report back.\n'),
      sentUuid: 'uuid-letter-1'
    })
    expect(outcome.state).toBe('admitted')
    await vi.waitFor(() => expect(rows(ledger)).toHaveLength(1))
    const [row] = rows(ledger)
    expect(row).toEqual({
      v: 1,
      at: TOOK_AT,
      agent: 'claude',
      session: 'provider-session',
      uuid: 'uuid-letter-1',
      sha256: agentLetterTextHash('Please review PR 12\nthen report back.')
    })
    expect(readFileSync(ledger, 'utf8')).not.toContain('review')
    expect(statSync(ledger).mode & 0o777).toBe(0o600)
    // The hash covers exactly the text Claude was sent.
    const sent = send.mock.calls[0][0] as { message: { content: unknown[] } }
    expect(row.sha256).toBe(agentLetterTextHash(claudeContentText(sent.message.content)))
  })

  it('appends, never rewrites', async () => {
    const session = sessionFor()
    await dispatchClaudeTurn(session, { body: letter('one'), sentUuid: 'u1' })
    await vi.waitFor(() => expect(rows(ledger)).toHaveLength(1))
    await dispatchClaudeTurn(session, { body: letter('two'), sentUuid: 'u2' })
    await vi.waitFor(() => expect(rows(ledger)).toHaveLength(2))
    expect(rows(ledger).map((row) => row.uuid)).toEqual(['u1', 'u2'])
  })

  it("leaves the person's own message out", async () => {
    const session = sessionFor()
    const outcome = await dispatchClaudeTurn(session, {
      body: userMessage([{ type: 'text', text: 'Please review PR 12' }]),
      sentUuid: 'uuid-person'
    })
    expect(outcome.state).toBe('admitted')
    await expectOnlySentinelRow()
  })

  it('writes nothing when the send fails', async () => {
    const session = sessionFor(vi.fn().mockRejectedValue(new Error('pipe closed')))
    const outcome = await dispatchClaudeTurn(session, {
      body: letter('Please review PR 12'),
      sentUuid: 'uuid-failed'
    })
    expect(outcome.state).not.toBe('admitted')
    expect(outcome.state).not.toBe('accepted')
    await expectOnlySentinelRow()
  })
})

describe('agent letter ledger path and text form', () => {
  it('takes the override, then XDG_STATE_HOME, and refuses a default under vitest', () => {
    expect(
      agentLetterLedgerPath({ [AGENT_LETTER_LEDGER_ENV]: '/tmp/x.jsonl', VITEST: 'true' })
    ).toBe('/tmp/x.jsonl')
    expect(agentLetterLedgerPath({ XDG_STATE_HOME: '/state' })).toBe(
      join('/state', 'orca', 'agent-letters.jsonl')
    )
    expect(agentLetterLedgerPath({ VITEST: 'true' })).toBeNull()
  })

  it('normalizes line endings and outer whitespace only', () => {
    expect(normalizeAgentLetterText('\n  a\r\nb\rc  \n')).toBe('a\nb\nc')
    expect(normalizeAgentLetterText('a  b')).toBe('a  b')
    expect(agentLetterTextHash('a\r\nb')).toBe(agentLetterTextHash('a\nb\n'))
  })

  it('reads text blocks the way Claude joins them', () => {
    expect(
      claudeContentText([
        { type: 'image', source: {} },
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two' }
      ])
    ).toBe('one\ntwo')
  })
})
