// Server updates (FORK.md, SLRM-2310): the RPC contract. `fork.serverUpdate.*` runs on the server
// that installs (host-admin for anything that changes it); `fork.servers.*` runs on the desktop that
// asks its paired servers one at a time. No call carries an address, a checksum or a signer: the
// server reads those from its own settings.
import { z } from 'zod'

const Version = z
  .string()
  .trim()
  .regex(/^\d{1,6}\.\d{1,6}\.\d{1,9}$/, 'a release version such as 1.4.261002')
const WaitMinutes = z
  .number()
  .int()
  .min(0)
  .max(24 * 60)
const ServerName = z.string().trim().min(1).max(256)

// Plain objects with no transforms or defaults (the mobile RPC fence compares parsed shapes).
export const ForkServerUpdateStatusParams = z.object({})

export const ForkServerUpdateApplyParams = z.object({
  version: Version,
  /** Install a version older than the running one. */
  allowDowngrade: z.boolean().optional(),
  /** Restart without waiting for running turns. */
  now: z.boolean().optional(),
  /** Minutes to wait for running turns; the server's setting when left out. */
  waitMinutes: WaitMinutes.optional()
})

export const ForkServerUpdateRollbackParams = z.object({
  now: z.boolean().optional(),
  waitMinutes: WaitMinutes.optional()
})

export const ForkServersListParams = z.object({})

export const ForkServersUpdateParams = z.object({
  /** Paired servers by name or environment id; empty or absent with `all` means every one. */
  servers: z.array(ServerName).max(64).optional(),
  all: z.boolean().optional(),
  /** The version to install; this desktop's own when left out. */
  version: Version.optional(),
  allowDowngrade: z.boolean().optional(),
  now: z.boolean().optional(),
  waitMinutes: WaitMinutes.optional()
})

export const ForkServersRollbackParams = z.object({
  server: ServerName,
  now: z.boolean().optional(),
  waitMinutes: WaitMinutes.optional()
})

export const ForkServersRunParams = z.object({ runId: z.string().trim().min(1).max(64) })

export type ForkServerInstallKind = 'mac-app' | 'linux-server'

export type ForkServerUpdatePhase =
  | 'downloading'
  | 'verifying'
  | 'waiting'
  | 'restarting'
  | 'done'
  | 'failed'
  | 'rolled-back'

export type ForkServerUpdateJob = {
  id: string
  kind: 'update' | 'rollback'
  phase: ForkServerUpdatePhase
  fromVersion: string
  targetVersion: string
  startedAt: number
  updatedAt: number
  /** Running turns while it waits. */
  busy?: number
  message?: string
}

export type ForkServerUpdateStatus = {
  version: string
  platform: string
  arch: string
  /** Where the release would be installed, or null with `problem` saying why it cannot be. */
  install: { kind: ForkServerInstallKind; path: string; service: string } | null
  problem?: string
  accept: boolean
  /** The version kept for a rollback, when one is kept. */
  previousVersion: string | null
  job: ForkServerUpdateJob | null
}

export type ForkServerUpdateStartResult = { job: ForkServerUpdateJob } | { current: true }

export type ForkServerRow = {
  id: string
  name: string
  /** Null when the server did not answer or has no update support. */
  status: ForkServerUpdateStatus | null
  /** unreachable, or no-support (an Orca without these methods). */
  error?: 'unreachable' | 'no-support'
  /** -1 behind this desktop, 0 the same, 1 ahead; null when either version is not comparable. */
  versus: number | null
}

export type ForkServersListResult = { version: string; servers: ForkServerRow[] }

export type ForkServerUpdateOutcome =
  | 'pending'
  | 'running'
  | 'updated'
  | 'current'
  | 'skipped'
  | 'failed'
  | 'rolled-back'

export type ForkServersRunRow = {
  id: string
  name: string
  outcome: ForkServerUpdateOutcome
  phase?: ForkServerUpdatePhase
  fromVersion?: string
  version?: string
  message?: string
}

export type ForkServersRunResult = {
  runId: string
  targetVersion: string
  done: boolean
  rows: ForkServersRunRow[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const PHASES: readonly string[] = [
  'downloading',
  'verifying',
  'waiting',
  'restarting',
  'done',
  'failed',
  'rolled-back'
] satisfies readonly ForkServerUpdatePhase[]

function isJob(value: unknown): value is ForkServerUpdateJob {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.phase === 'string' &&
    PHASES.includes(value.phase) &&
    (value.kind === 'update' || value.kind === 'rollback') &&
    typeof value.targetVersion === 'string' &&
    typeof value.fromVersion === 'string'
  )
}

/** A server's status reply as the desktop reads it; anything else is treated as no answer. */
export function isForkServerUpdateStatus(value: unknown): value is ForkServerUpdateStatus {
  return (
    isRecord(value) &&
    typeof value.version === 'string' &&
    typeof value.accept === 'boolean' &&
    (value.job === null || value.job === undefined || isJob(value.job))
  )
}

export function isForkServerUpdateStartResult(
  value: unknown
): value is ForkServerUpdateStartResult {
  return isRecord(value) && (value.current === true || isJob(value.job))
}
