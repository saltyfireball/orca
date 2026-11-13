// SLRM-2103 (FORK.md "Usage ledger and cache-cold cue"): the ledger's file in the app's data
// folder. Writes are batched (one write per quiet spell) and flushed on quit; an unreadable file
// starts an empty ledger rather than failing start-up.
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { writeFileAtomically } from '../../filesystem/atomic-file-publication'
import { emptyLedgerData, parseLedgerData, type UsageLedgerData } from './usage-ledger-model'

export const USAGE_LEDGER_FILE_NAME = 'fork-usage-ledger.json'
export const USAGE_LEDGER_WRITE_DELAY_MS = 10_000

export function readLedgerFile(path: string): UsageLedgerData {
  if (!existsSync(path)) {
    return emptyLedgerData()
  }
  try {
    return parseLedgerData(readFileSync(path, 'utf8'))
  } catch (error) {
    console.warn('[fork-usage-ledger] Could not read the usage ledger; starting empty:', error)
    return emptyLedgerData()
  }
}

export function writeLedgerFile(path: string, data: UsageLedgerData): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileAtomically(path, JSON.stringify(data), { mode: 0o600 })
}

/** Coalesces saves: `schedule` after each change, `flush` on quit. */
export class LedgerFileWriter {
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly save: () => void,
    private readonly delayMs = USAGE_LEDGER_WRITE_DELAY_MS
  ) {}

  schedule(): void {
    if (this.timer) {
      return
    }
    this.timer = setTimeout(() => this.flush(), this.delayMs)
    this.timer.unref?.()
  }

  flush(): void {
    if (!this.timer) {
      return
    }
    clearTimeout(this.timer)
    this.timer = null
    try {
      this.save()
    } catch (error) {
      console.warn('[fork-usage-ledger] Could not save the usage ledger:', error)
    }
  }
}
