// BAD-679: terminal agents' spend read from their transcripts, with hardcoded rows.
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FORK_USAGE_NO_TOKENS } from '../../../shared/fork/usage-ledger'
import { UsageLedger } from './usage-ledger'
import { TerminalSpendTracker, terminalTranscriptPath } from './terminal-spend'
import {
  CodexRolloutReader,
  codexChatUsageTotals,
  parseClaudeTranscriptRow,
  readTranscriptRows
} from './transcript-usage'
import { cleanUsagePrices, usagePricer } from './usage-report'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'transcript-usage-'))
  dirs.push(dir)
  return dir
}

const claudeRow = (id: string, output: number, timestamp = '2026-11-22T10:00:00.000Z') =>
  JSON.stringify({
    type: 'assistant',
    timestamp,
    message: {
      id,
      model: 'claude-sonnet-4-5',
      usage: { input_tokens: 100, output_tokens: output, cache_read_input_tokens: 1000 }
    }
  })

const turnContext = (model: string) =>
  JSON.stringify({
    type: 'turn_context',
    timestamp: '2026-11-22T10:00:00.000Z',
    payload: { model }
  })

const tokenCount = (input: number, cached: number, output: number, timestamp: string) =>
  JSON.stringify({
    type: 'event_msg',
    timestamp,
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output
        }
      }
    }
  })

describe('transcript rows', () => {
  it('reads a Claude call and nothing else', () => {
    const parsed = parseClaudeTranscriptRow(claudeRow('msg_1', 50))
    expect(parsed?.call).toMatchObject({
      callId: 'msg_1',
      model: 'claude-sonnet-4-5',
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 1000 }
    })
    expect(parsed?.at).toBe(Date.parse('2026-11-22T10:00:00.000Z'))
    expect(parseClaudeTranscriptRow(JSON.stringify({ type: 'user', message: {} }))).toBeNull()
    expect(parseClaudeTranscriptRow('not json')).toBeNull()
  })

  it('turns Codex running totals into growth, after the baseline', () => {
    const reader = new CodexRolloutReader()
    const start = Date.parse('2026-11-22T10:00:00.000Z')
    expect(reader.row(turnContext('gpt-5.1-codex'), start)).toBeNull()
    // Before Orca began watching: moves the baseline only.
    expect(reader.row(tokenCount(1000, 400, 100, '2026-11-22T09:00:00.000Z'), start)).toBeNull()
    const growth = reader.row(tokenCount(3000, 1400, 300, '2026-11-22T10:05:00.000Z'), start)
    expect(growth).toEqual({
      model: 'gpt-5.1-codex',
      delta: {
        ...FORK_USAGE_NO_TOKENS,
        inputTokens: 1000,
        cacheReadTokens: 1000,
        outputTokens: 200
      }
    })
    // A rate-limit row has no usage, and an unchanged total adds nothing.
    expect(
      reader.row(
        JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: null } }),
        start
      )
    ).toBeNull()
    expect(reader.row(tokenCount(3000, 1400, 300, '2026-11-22T10:06:00.000Z'), start)).toBeNull()
  })

  it('reads a Codex chat frame, cached tokens apart from input', () => {
    expect(
      codexChatUsageTotals({
        tokenUsage: { total: { inputTokens: 900, cachedInputTokens: 300, outputTokens: 50 } }
      })
    ).toEqual({ ...FORK_USAGE_NO_TOKENS, inputTokens: 600, cacheReadTokens: 300, outputTokens: 50 })
    expect(codexChatUsageTotals({})).toBeNull()
  })

  it('reads only whole rows past an offset', async () => {
    const dir = scratch()
    const file = join(dir, 't.jsonl')
    writeFileSync(file, 'one\ntwo\npart')
    const first = await readTranscriptRows(file, 0)
    expect(first.lines).toEqual(['one', 'two'])
    appendFileSync(file, 'ial\n')
    const second = await readTranscriptRows(file, first.offset)
    expect(second.lines).toEqual(['partial'])
    expect((await readTranscriptRows(join(dir, 'missing.jsonl'), 5)).offset).toBe(5)
  })

  it('accepts only absolute .jsonl paths', () => {
    expect(terminalTranscriptPath('/Users/x/.claude/projects/p/s.jsonl')).not.toBeNull()
    expect(terminalTranscriptPath('relative/s.jsonl')).toBeNull()
    expect(terminalTranscriptPath('/etc/passwd')).toBeNull()
    expect(terminalTranscriptPath('/a/b\u0000.jsonl')).toBeNull()
  })
})

describe('TerminalSpendTracker into the ledger', () => {
  function setup(notBefore: number) {
    const clock = { now: Date.parse('2026-11-22T12:00:00.000Z') }
    const ledger = new UsageLedger({ now: () => clock.now, dayKey: () => '2026-11-22' })
    const tracker = new TerminalSpendTracker(
      {
        call: (id, agent, call) => ledger.observeTranscriptCall(id, agent, call),
        delta: (id, agent, model, delta) => ledger.observeTranscriptDelta(id, agent, model, delta)
      },
      notBefore
    )
    return { ledger, tracker }
  }
  const price = usagePricer(cleanUsagePrices({}))
  const cost = (ledger: UsageLedger, id: string): number => {
    let total = 0
    for (const models of Object.values(ledger.snapshot().chats[id].days)) {
      for (const [model, cell] of Object.entries(models)) {
        total += price(model, cell.tokens) ?? 0
      }
    }
    return total
  }

  it('counts a Claude terminal once per call and ignores history from before the watch', async () => {
    const file = join(scratch(), 'claude.jsonl')
    writeFileSync(
      file,
      `${[
        claudeRow('old', 99_999, '2026-11-01T00:00:00.000Z'),
        claudeRow('msg_1', 40),
        claudeRow('msg_1', 80)
      ].join('\n')}\n`
    )
    const { ledger, tracker } = setup(Date.parse('2026-11-22T00:00:00.000Z'))
    tracker.note('tab:1', 'claude', file)
    expect(await tracker.read('tab:1')).toBe(true)
    const chat = ledger.snapshot().chats['tab:1']
    expect(chat).toMatchObject({ terminal: true, agent: 'claude' })
    expect(Object.values(chat.days['2026-11-22'])[0].tokens).toMatchObject({
      inputTokens: 100,
      outputTokens: 80,
      cacheReadTokens: 1000
    })
    expect(ledger.cacheStates()).toEqual([])
    // sonnet: 100 in, 80 out, 1000 cache read at $3 / $15 / $0.30 per million.
    expect(cost(ledger, 'tab:1')).toBeCloseTo((100 * 3 + 80 * 15 + 1000 * 0.3) / 1_000_000, 8)
    expect(await tracker.read('tab:1')).toBe(false)
  })

  it('prices a Codex terminal with the Codex table', async () => {
    const file = join(scratch(), 'rollout.jsonl')
    writeFileSync(
      file,
      `${[
        turnContext('gpt-5.1-codex'),
        tokenCount(2_000_000, 1_000_000, 100_000, '2026-11-22T11:00:00.000Z')
      ].join('\n')}\n`
    )
    const { ledger, tracker } = setup(Date.parse('2026-11-22T00:00:00.000Z'))
    tracker.note('tab:2', 'codex', file)
    await tracker.read('tab:2')
    // 1M uncached input at $1.25, 1M cached at $0.125 and 100k output at $10 per million.
    expect(cost(ledger, 'tab:2')).toBeCloseTo(1.25 + 0.125 + 1, 6)
  })

  it('ignores an agent it has no reader for', () => {
    const { tracker } = setup(0)
    tracker.note('tab:3', 'gemini', '/a/b.jsonl')
    expect(tracker.has('tab:3')).toBe(false)
  })
})

describe('UsageLedger.observeCumulative (native Codex chats)', () => {
  it('adds only growth, so a replayed total adds nothing, and starts over when a total falls', () => {
    const ledger = new UsageLedger({ now: () => 1000, dayKey: () => '2026-11-22' })
    const total = (input: number, output: number) => ({
      ...FORK_USAGE_NO_TOKENS,
      inputTokens: input,
      outputTokens: output
    })
    expect(ledger.observeCumulative('c1', 'codex', 'gpt-5.1-codex', total(100, 10))).toBe(true)
    expect(ledger.observeCumulative('c1', 'codex', 'gpt-5.1-codex', total(100, 10))).toBe(false)
    ledger.observeCumulative('c1', 'codex', 'gpt-5.1-codex', total(250, 30))
    const cell = ledger.snapshot().chats.c1.days['2026-11-22']['gpt-5.1-codex']
    expect(cell.tokens).toMatchObject({ inputTokens: 250, outputTokens: 30 })
    ledger.observeCumulative('c1', 'codex', 'gpt-5.1-codex', total(20, 5))
    expect(ledger.snapshot().chats.c1.days['2026-11-22']['gpt-5.1-codex'].tokens).toMatchObject({
      inputTokens: 270,
      outputTokens: 35
    })
    expect(ledger.snapshot().chats.c1.agent).toBe('codex')
  })
})
