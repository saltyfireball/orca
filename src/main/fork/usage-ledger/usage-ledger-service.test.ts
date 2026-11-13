import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ForkUsageLedgerSettings } from '../../../shared/fork/usage-ledger'
import { assistantFrame, fakeClock } from './usage-ledger-fixtures'
import {
  forkUsageLedgerData,
  forkUsageLedgerObserveClaudeEvent,
  installForkUsageLedgerService,
  watchForkUsageRetention
} from './usage-ledger-service'

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

describe('usage ledger retention', () => {
  it('prunes at once when the retention setting changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ulsvc-'))
    dirs.push(dir)
    const clock = fakeClock()
    let settings: ForkUsageLedgerSettings = { forkUsageRetentionDays: 90 }
    flushes.push(
      installForkUsageLedgerService({
        filePath: join(dir, 'ledger.json'),
        readSettings: () => settings,
        chatMeta: () => undefined,
        now: clock.now
      })
    )
    const feed = (sessionId: string, id: string): void =>
      forkUsageLedgerObserveClaudeEvent({
        type: 'message',
        sessionId,
        message: assistantFrame({ id, input: 10 })
      })
    feed('old', 'msg_1')
    clock.advance(40 * 86_400_000)
    feed('new', 'msg_2')
    let listener: ((updates: Partial<ForkUsageLedgerSettings>) => void) | undefined
    watchForkUsageRetention({ onSettingsChanged: (next) => (listener = next) })

    listener?.({ forkCacheColdCue: false })
    expect(Object.keys(forkUsageLedgerData()?.chats ?? {}).sort()).toEqual(['new', 'old'])

    settings = { forkUsageRetentionDays: 30 }
    listener?.({ forkUsageRetentionDays: 30 })
    expect(Object.keys(forkUsageLedgerData()?.chats ?? {})).toEqual(['new'])
  })
})
