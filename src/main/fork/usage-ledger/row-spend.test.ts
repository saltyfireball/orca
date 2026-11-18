import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ForkUsageLedgerSettings } from '../../../shared/fork/usage-ledger'
import { FORK_USAGE_NO_TOKENS } from '../../../shared/fork/usage-ledger'
import { assistantFrame, fakeClock, initFrame } from './usage-ledger-fixtures'
import { chatSpend } from './row-spend'
import type { UsageChatRecord } from './usage-ledger-model'
import {
  forkUsageLedgerCacheStates,
  forkUsageLedgerObserveClaudeEvent,
  installForkUsageLedgerService
} from './usage-ledger-service'

const tokens = (input: number) => ({ ...FORK_USAGE_NO_TOKENS, inputTokens: input })

function chat(days: UsageChatRecord['days']): UsageChatRecord {
  return {
    sessionId: 's',
    agent: 'claude',
    firstAt: 0,
    lastAt: 0,
    turns: 0,
    days,
    contextTokens: 0,
    recentCalls: []
  }
}

describe('chatSpend', () => {
  it('adds every day and model that has a price, and flags tokens without one', () => {
    const pricer = (model: string, cell: { inputTokens: number }) =>
      model === 'priced' ? cell.inputTokens / 1000 : null
    expect(
      chatSpend(
        chat({
          '2026-11-17': { priced: { tokens: tokens(1000), calls: 1 } },
          '2026-11-18': {
            priced: { tokens: tokens(500), calls: 1 },
            unknown: { tokens: tokens(20), calls: 1 }
          }
        }),
        pricer
      )
    ).toEqual({ costUsd: 1.5, unpriced: true })
  })

  it('leaves the cost out when nothing has a price, and empty cells do not count as unpriced', () => {
    expect(chatSpend(chat({}), () => 1)).toEqual({})
    expect(
      chatSpend(chat({ d: { unknown: { tokens: tokens(0), calls: 0 } } }), () => null)
    ).toEqual({})
  })
})

const dirs: string[] = []
const flushes: (() => void)[] = []

afterEach(() => {
  for (const flush of flushes.splice(0)) {
    flush()
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('cache states carry the spend', () => {
  it('prices each chat with the user price table and keeps its billing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rowspend-'))
    dirs.push(dir)
    const settings: ForkUsageLedgerSettings = {
      forkUsagePrices: {
        'test-model': { input: 2, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    }
    flushes.push(
      installForkUsageLedgerService({
        filePath: join(dir, 'ledger.json'),
        readSettings: () => settings,
        chatMeta: () => undefined,
        now: fakeClock().now
      })
    )
    const feed = (message: Record<string, unknown>): void =>
      forkUsageLedgerObserveClaudeEvent({ type: 'message', sessionId: 'chat-a', message })
    feed(initFrame('none'))
    feed(assistantFrame({ id: 'msg_1', model: 'test-model', input: 500_000 }))
    expect(forkUsageLedgerCacheStates()).toMatchObject([
      { sessionId: 'chat-a', contextTokens: 500_000, costUsd: 1, billing: 'subscription' }
    ])
  })
})
