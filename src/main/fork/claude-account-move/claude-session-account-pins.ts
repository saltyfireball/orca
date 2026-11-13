// SLRM-1503: which Claude account a moved native chat launches under, by Orca session id. A pin
// outranks the global selection for that one chat only, so moving one chat leaves the others on
// whatever account they follow. Kept on the host that runs the chat (each runtime has its own).
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomically } from '../../filesystem/atomic-file-publication'
import { getProfileUserDataPath } from '../../orca-profiles/profile-storage-paths'

/** An account id, or `null` for System default. */
export type ClaudeSessionPin = string | null

const SYSTEM_DEFAULT = 'system'

type PinFile = { version: 1; pins: Record<string, { accountId: string }> }

function readPinFile(path: string): Map<string, ClaudeSessionPin> {
  const pins = new Map<string, ClaudeSessionPin>()
  try {
    // One read per process, cached: launches read pins synchronously and must not start unpinned.
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const entries =
      parsed && typeof parsed === 'object' && 'pins' in parsed && parsed.pins
        ? Object.entries(parsed.pins)
        : []
    for (const [sessionId, entry] of entries) {
      const accountId: unknown =
        entry && typeof entry === 'object' && 'accountId' in entry ? entry.accountId : undefined
      if (typeof accountId === 'string' && accountId.length > 0) {
        pins.set(sessionId, accountId === SYSTEM_DEFAULT ? null : accountId)
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return pins
    }
    // An unreadable file pins nothing: every chat then follows the global selection, as stock does.
    console.warn('[fork-claude-account-move] Could not read session pins:', error)
  }
  return pins
}

export class ClaudeSessionAccountPins {
  private cache: Map<string, ClaudeSessionPin> | null = null
  // Writes run one at a time, each saving the pins as they are when it starts.
  private writes: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  private pins(): Map<string, ClaudeSessionPin> {
    this.cache ??= readPinFile(this.path)
    return this.cache
  }

  /** `undefined` when the chat has no pin and follows the global selection. */
  get(sessionId: string): ClaudeSessionPin | undefined {
    const pins = this.pins()
    return pins.has(sessionId) ? (pins.get(sessionId) ?? null) : undefined
  }

  set(sessionId: string, pin: ClaudeSessionPin | undefined): Promise<void> {
    const pins = this.pins()
    if (pin === undefined) {
      if (!pins.delete(sessionId)) {
        return this.writes
      }
    } else {
      pins.set(sessionId, pin)
    }
    return this.write(pins)
  }

  /** Drop every pin naming `accountId`, e.g. when that account is removed. */
  forgetAccount(accountId: string): Promise<void> {
    const pins = this.pins()
    let changed = false
    for (const [sessionId, pin] of pins) {
      if (pin === accountId) {
        pins.delete(sessionId)
        changed = true
      }
    }
    return changed ? this.write(pins) : this.writes
  }

  /** The in-memory pins change at once; the file follows in call order. Rejects if this write fails. */
  private write(pins: Map<string, ClaudeSessionPin>): Promise<void> {
    const save = async (): Promise<void> => {
      const file: PinFile = { version: 1, pins: {} }
      for (const [sessionId, pin] of pins) {
        file.pins[sessionId] = { accountId: pin ?? SYSTEM_DEFAULT }
      }
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      // Upstream's writer keeps its Windows ACL repair and rename retry for this small file.
      writeFileAtomically(this.path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
    }
    const run = this.writes.then(save, save)
    this.writes = run.catch(() => undefined)
    return run
  }
}

let installed: ClaudeSessionAccountPins | null = null

export function claudeSessionAccountPins(): ClaudeSessionAccountPins {
  installed ??= new ClaudeSessionAccountPins(
    join(getProfileUserDataPath(), 'fork-claude-session-accounts.json')
  )
  return installed
}

export function setClaudeSessionAccountPinsForTests(pins: ClaudeSessionAccountPins | null): void {
  installed = pins
}
