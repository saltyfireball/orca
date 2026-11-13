// SLRM-2103 (FORK.md "Usage ledger and cache-cold cue"): the ledger's file in the app's data
// folder. Writes are batched (one write per quiet spell) and flushed on quit; an unreadable file
// starts an empty ledger rather than failing start-up.
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { writeFileAtomically } from '../../filesystem/atomic-file-publication'
import { emptyLedgerData, parseLedgerData, type UsageLedgerData } from './usage-ledger-model'

export const USAGE_LEDGER_FILE_NAME = 'fork-usage-ledger.json'
export const USAGE_LEDGER_WRITE_DELAY_MS = 10_000

/**
 * Start-up only (once, at install): reads the saved ledger and makes sure its folder exists, so
 * the batched saves after it need no folder work. The saves stay synchronous through the shared
 * atomic writer because the quit flush must land before the process exits.
 */
export function readLedgerFile(path: string): UsageLedgerData {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  } catch (error) {
    console.warn('[fork-usage-ledger] Could not create the usage ledger folder:', error)
  }
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
