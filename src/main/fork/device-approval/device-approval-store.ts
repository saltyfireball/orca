// SLRM-2271 (FORK.md "Device approval"): which paired devices are approved and which wait, kept
// beside the device registry in fork-device-approvals.json (owner-only file mode).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomInt } from 'node:crypto'
import { writeDurableSecureJsonFile } from '../../../shared/secure-storage/secure-file'
import { normalizeForkApprovalCode } from '../../../shared/fork/device-approval'

export const DEVICE_APPROVALS_FILE = 'fork-device-approvals.json'

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const MAX_PENDING = 100

export type PendingApproval = {
  code: string
  firstAttemptAt: number
  lastAttemptAt: number
  attempts: number
}

type ApprovalFile = {
  version: 1
  trusted: string[]
  pending: Record<string, PendingApproval>
}

function newCode(): string {
  let code = ''
  for (let index = 0; index < 8; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

function parse(raw: unknown): ApprovalFile | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const record = raw as Partial<ApprovalFile>
  if (!Array.isArray(record.trusted)) {
    return null
  }
  const pending: Record<string, PendingApproval> = {}
  for (const [id, entry] of Object.entries(record.pending ?? {})) {
    if (entry && typeof entry.code === 'string' && typeof entry.firstAttemptAt === 'number') {
      pending[id] = {
        code: entry.code,
        firstAttemptAt: entry.firstAttemptAt,
        lastAttemptAt: Number(entry.lastAttemptAt) || entry.firstAttemptAt,
        attempts: Number(entry.attempts) || 1
      }
    }
  }
  return {
    version: 1,
    trusted: record.trusted.filter((id): id is string => typeof id === 'string'),
    pending
  }
}

export class DeviceApprovalStore {
  private readonly path: string
  private trusted = new Set<string>()
  private pending = new Map<string, PendingApproval>()
  /** False until a file exists; the first use then approves every device already seen. */
  private baselined: boolean

  constructor(userDataPath: string) {
    this.path = join(userDataPath, DEVICE_APPROVALS_FILE)
    this.baselined = existsSync(this.path)
    if (!this.baselined) {
      return
    }
    let file: ApprovalFile | null = null
    try {
      file = parse(JSON.parse(readFileSync(this.path, 'utf8')))
    } catch (error) {
      console.error('[device-approval] Could not read the approvals file:', error)
    }
    // Why: an unreadable file approves nobody; re-baselining would approve a leaked link's holder.
    if (file) {
      this.trusted = new Set(file.trusted)
      this.pending = new Map(Object.entries(file.pending))
    }
  }

  /** Upgrade path: devices already seen when this file is first made stay approved. */
  baselineOnce(seenDeviceIds: () => readonly string[]): void {
    if (this.baselined) {
      return
    }
    this.baselined = true
    for (const id of seenDeviceIds()) {
      this.trusted.add(id)
    }
    this.save()
  }

  isTrusted(deviceId: string): boolean {
    return this.trusted.has(deviceId)
  }

  trust(deviceId: string): void {
    const changed = !this.trusted.has(deviceId) || this.pending.has(deviceId)
    this.trusted.add(deviceId)
    this.pending.delete(deviceId)
    if (changed) {
      this.save()
    }
  }

  forget(deviceId: string): void {
    const changed = this.trusted.delete(deviceId) || this.pending.delete(deviceId)
    if (changed) {
      this.save()
    }
  }

  /** Records an attempt and returns the code the waiting device is shown. */
  recordAttempt(deviceId: string, now: number): PendingApproval {
    const existing = this.pending.get(deviceId)
    if (existing) {
      // Attempt counts stay in memory; only a new entry is worth a disk write.
      existing.lastAttemptAt = now
      existing.attempts += 1
      return existing
    }
    const entry = { code: newCode(), firstAttemptAt: now, lastAttemptAt: now, attempts: 1 }
    this.pending.set(deviceId, entry)
    if (this.pending.size > MAX_PENDING) {
      const oldest = [...this.pending.entries()].sort(
        (a, b) => a[1].lastAttemptAt - b[1].lastAttemptAt
      )[0]
      this.pending.delete(oldest[0])
    }
    this.save()
    return entry
  }

  pendingFor(deviceId: string): PendingApproval | undefined {
    return this.pending.get(deviceId)
  }

  findPendingByCode(value: string): string | undefined {
    const wanted = normalizeForkApprovalCode(value)
    if (wanted.length === 0) {
      return undefined
    }
    for (const [id, entry] of this.pending) {
      if (normalizeForkApprovalCode(entry.code) === wanted) {
        return id
      }
    }
    return undefined
  }

  /** Drops waiting entries whose device row is gone. */
  prunePending(exists: (deviceId: string) => boolean): void {
    let changed = false
    for (const id of Array.from(this.pending.keys())) {
      if (!exists(id)) {
        this.pending.delete(id)
        changed = true
      }
    }
    if (changed) {
      this.save()
    }
  }

  private save(): void {
    try {
      writeDurableSecureJsonFile(this.path, {
        version: 1,
        trusted: [...this.trusted],
        pending: Object.fromEntries(this.pending)
      } satisfies ApprovalFile)
    } catch (error) {
      console.error('[device-approval] Could not save the approvals file:', error)
    }
  }
}
