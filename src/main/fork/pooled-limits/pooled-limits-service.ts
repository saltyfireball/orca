// Pooled limits (FORK.md, SLRM-2392): `fork.limits.machineUsage` answers for this machine, and
// `fork.limits.usage` asks this machine and every paired server (as auto placement's probe does),
// then dedupes accounts by identity and pools them. A paired server's answer is checked field by
// field before it is counted. Keep electron out of this file (the headless server bundles it).
import { z } from 'zod'
import { mapWithConcurrency } from '../../../shared/concurrency/map-with-concurrency'
import { withTimeout } from '../../../shared/concurrency/promise-timeout-fallback'
import {
  poolForkLimits,
  readForkPooledLimitsSettings,
  type ForkMachineUsageResult,
  type ForkPooledLimitsResult,
  type ForkPooledLimitsSettings,
  type MachineReadings,
  type PooledAccountReading,
  type PooledMachine
} from '../../../shared/fork/pooled-limits'
import {
  readPooledMachineAccounts,
  type DefaultClaudeLogin,
  type PooledLimitsSnapshot
} from './pooled-limits-machine'

export type PooledLimitsDeps = {
  settings: () => ForkPooledLimitsSettings | null
  /** This machine's accounts snapshot; null where it has no account services. */
  snapshot: () => PooledLimitsSnapshot | null
  /** Reads usage again where it is stale; slow probes keep running past the wait. */
  refresh: () => Promise<void>
  defaultClaudeLogin: () => Promise<DefaultClaudeLogin>
  /** Paired servers saved on this machine. */
  listEnvironments: () =>
    | readonly { id: string; name: string }[]
    | Promise<readonly { id: string; name: string }[]>
  callEnvironment: (
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown>
  now?: () => number
}

const REFRESH_WAIT_MS = 10_000
const PROBE_TIMEOUT_MS = 4_000
const PROBE_REFRESH_TIMEOUT_MS = 15_000
const PROBE_CONCURRENCY = 4
const MAX_ACCOUNTS_PER_MACHINE = 100
export const POOLED_LIMITS_LOCAL_KEY = 'local'
const LOCAL_NAME = 'this machine'

const windowSchema = z
  .object({
    usedPercent: z.number().finite().min(0).max(1000),
    resetsAt: z.number().finite().nullable()
  })
  .nullable()

const readingSchema = z.object({
  provider: z.enum(['claude', 'codex']),
  emailKey: z.string().regex(/^[0-9a-f]{8,64}$/),
  orgKey: z
    .string()
    .regex(/^[0-9a-f]{8,64}$/)
    .nullable(),
  label: z.string().max(200),
  plan: z.string().max(40).nullable(),
  session: windowSchema,
  weekly: windowSchema,
  updatedAt: z.number().finite().min(0)
})

// Control characters (terminal escapes among them) never reach the CLI or the popover.
// oxlint-disable-next-line no-control-regex -- matching them is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g
// A server's clock may run a little ahead; a reading far in the future cannot win the dedupe.
const MAX_CLOCK_SKEW_MS = 5 * 60_000

export function cleanPooledText(text: string): string {
  return text.replace(CONTROL_CHARS, ' ')
}

/** A paired server's accounts, or null when its answer is not the shape this build expects. */
export function parseMachineUsage(
  answer: unknown,
  now: number = Date.now()
): ForkMachineUsageResult | null {
  const fields = typeof answer === 'object' && answer !== null ? answer : {}
  if ('off' in fields && fields.off === true) {
    return { off: true, accounts: [] }
  }
  const accounts = 'accounts' in fields ? fields.accounts : undefined
  if (!Array.isArray(accounts)) {
    return null
  }
  const parsed: PooledAccountReading[] = []
  for (const entry of accounts.slice(0, MAX_ACCOUNTS_PER_MACHINE)) {
    const result = readingSchema.safeParse(entry)
    if (result.success) {
      const reading = result.data
      parsed.push({
        ...reading,
        label: cleanPooledText(reading.label),
        plan: reading.plan === null ? null : cleanPooledText(reading.plan),
        updatedAt: Math.min(reading.updatedAt, now + MAX_CLOCK_SKEW_MS)
      })
    }
  }
  return { accounts: parsed }
}

export async function readForkMachineUsage(
  deps: PooledLimitsDeps,
  params: { refresh?: boolean }
): Promise<ForkMachineUsageResult> {
  if (!readForkPooledLimitsSettings(deps.settings()).enabled) {
    return { off: true, accounts: [] }
  }
  if (params.refresh) {
    await withTimeout(
      deps.refresh().catch(() => undefined),
      REFRESH_WAIT_MS,
      undefined
    )
  }
  const snapshot = deps.snapshot()
  if (!snapshot) {
    return { accounts: [] }
  }
  const needsLogin = snapshot.claude.accounts.length === 0 && !snapshot.claude.systemDefaultEmail
  const login = needsLogin ? await deps.defaultClaudeLogin().catch(() => null) : null
  return { accounts: readPooledMachineAccounts(snapshot, login) }
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

async function probeEnvironment(
  deps: PooledLimitsDeps,
  environment: { id: string; name: string },
  refresh: boolean
): Promise<{ machine: PooledMachine; readings: MachineReadings | null }> {
  const base = {
    key: `runtime:${environment.id}`,
    name: cleanPooledText(environment.name.slice(0, 200))
  }
  try {
    const answer = await deps.callEnvironment(
      environment.id,
      'fork.limits.machineUsage',
      refresh ? { refresh: true } : {},
      refresh ? PROBE_REFRESH_TIMEOUT_MS : PROBE_TIMEOUT_MS
    )
    const parsed = parseMachineUsage(answer, (deps.now ?? Date.now)())
    if (!parsed) {
      return { machine: { ...base, status: 'unreachable', accounts: 0 }, readings: null }
    }
    if (parsed.off) {
      return { machine: { ...base, status: 'off', accounts: 0 }, readings: null }
    }
    return {
      machine: { ...base, status: 'ok', accounts: parsed.accounts.length },
      readings: { machineName: base.name, accounts: parsed.accounts }
    }
  } catch (error) {
    const status = errorCode(error) === 'method_not_found' ? 'no-probe' : 'unreachable'
    return { machine: { ...base, status, accounts: 0 }, readings: null }
  }
}

export async function readForkPooledLimits(
  deps: PooledLimitsDeps,
  params: { refresh?: boolean; local?: boolean }
): Promise<ForkPooledLimitsResult> {
  const now = deps.now ?? Date.now
  const config = readForkPooledLimitsSettings(deps.settings())
  if (!config.enabled) {
    return { now: now(), off: true, providers: [], machines: [] }
  }
  const refresh = params.refresh === true
  const environments =
    params.local || !config.servers
      ? []
      : await Promise.resolve(deps.listEnvironments()).catch(() => [])
  const [local, remote] = await Promise.all([
    readForkMachineUsage(deps, { refresh }).catch(() => ({ accounts: [] })),
    mapWithConcurrency([...environments], PROBE_CONCURRENCY, (environment) =>
      probeEnvironment(deps, environment, refresh)
    )
  ])
  const machines: PooledMachine[] = [
    {
      key: POOLED_LIMITS_LOCAL_KEY,
      name: LOCAL_NAME,
      status: 'ok',
      accounts: local.accounts.length
    },
    ...remote.map((probe) => probe.machine)
  ]
  const readings: MachineReadings[] = [
    { machineName: LOCAL_NAME, accounts: local.accounts },
    ...remote.flatMap((probe) => (probe.readings ? [probe.readings] : []))
  ]
  const at = now()
  return { now: at, providers: poolForkLimits(readings, at), machines }
}
