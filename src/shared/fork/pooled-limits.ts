// Pooled limits (FORK.md, SLRM-2392): every Claude and Codex account seen on this machine and its
// paired servers, one bar per provider and limit window (5-hour and weekly). Each machine reports
// only usage numbers per account: a hashed identity, a label, the plan and the two windows. No
// token or credential ever leaves a machine. The same account signed in on several machines is
// counted once, by its identity, with its freshest reading.
import { z } from 'zod'

export type PooledLimitsProvider = 'claude' | 'codex'
export type PooledLimitsWindowKind = 'session' | 'weekly'

export const POOLED_LIMITS_PROVIDERS: readonly PooledLimitsProvider[] = ['claude', 'codex']
export const POOLED_LIMITS_WINDOWS: readonly PooledLimitsWindowKind[] = ['session', 'weekly']

export type PooledAccountWindow = { usedPercent: number; resetsAt: number | null }

/** One account as one machine sees it. Keys are hashes, so emails and org ids are not compared in the clear. */
export type PooledAccountReading = {
  provider: PooledLimitsProvider
  /** Hash of the lowercased sign-in email. */
  emailKey: string
  /** Hash of the organization (Claude) or workspace (Codex) id; null when the machine does not know it. */
  orgKey: string | null
  /** The name the user gave the account, else its email. */
  label: string
  plan: string | null
  session: PooledAccountWindow | null
  weekly: PooledAccountWindow | null
  /** When the machine last read this account's usage, Unix ms; 0 when never. */
  updatedAt: number
}

export type ForkMachineUsageResult = {
  /** True when this machine's pooled limits setting is off: it shares nothing. */
  off?: boolean
  accounts: PooledAccountReading[]
}

export type PooledMachineStatus = 'ok' | 'off' | 'unreachable' | 'no-probe'

export type PooledMachine = {
  key: string
  name: string
  status: PooledMachineStatus
  accounts: number
}

export type PooledAccount = Omit<PooledAccountReading, 'emailKey' | 'orgKey'> & {
  /** Names of the machines this account was seen on. */
  machines: string[]
}

export type PooledLimitWindow = {
  kind: PooledLimitsWindowKind
  /** Mean of the accounts' used percent: each account is an equal share of the pool. */
  usedPercent: number
  /** Accounts that report this window. */
  accounts: number
  /** Soonest reset still ahead among accounts with usage in this window. */
  nextResetAt: number | null
  /** Pool percent points that reset then (accounts resetting within a minute of it count too). */
  freesPercent: number
}

export type PooledLimitsProviderRow = {
  provider: PooledLimitsProvider
  accounts: PooledAccount[]
  windows: PooledLimitWindow[]
}

export type ForkPooledLimitsResult = {
  now: number
  off?: boolean
  providers: PooledLimitsProviderRow[]
  machines: PooledMachine[]
}

// Plain objects with no transforms or defaults: the mobile RPC fence refuses wider parsed shapes.
export const ForkMachineUsageParams = z.object({ refresh: z.boolean().optional() })
export const ForkPooledLimitsParams = z.object({
  refresh: z.boolean().optional(),
  /** Only this machine, without asking paired servers. */
  local: z.boolean().optional()
})

export type ForkPooledLimitsSettings = {
  /** Fork (SLRM-2392): pooled usage limits in the usage popover, /usage-limits and `orca limits usage`; this machine shares its numbers with paired desktops. Unset is on. */
  forkPooledLimits?: boolean
  /** Fork (SLRM-2392): pooled limits also ask every paired server; unset is on. */
  forkPooledLimitsServers?: boolean
}

export function readForkPooledLimitsSettings(
  settings: ForkPooledLimitsSettings | null | undefined
): {
  enabled: boolean
  servers: boolean
} {
  return {
    enabled: settings?.forkPooledLimits !== false,
    servers: settings?.forkPooledLimitsServers !== false
  }
}

/** Two windows reset together when they are this close. */
const SAME_RESET_MS = 60_000

export type MachineReadings = { machineName: string; accounts: readonly PooledAccountReading[] }

type Cluster = {
  orgKey: string | null
  readings: { reading: PooledAccountReading; machine: string }[]
}

/** A reading with a reset already behind it has nothing used in that window any more. */
function liveWindow(window: PooledAccountWindow | null, now: number): PooledAccountWindow | null {
  if (!window || !Number.isFinite(window.usedPercent)) {
    return null
  }
  if (window.resetsAt !== null && window.resetsAt <= now) {
    return { usedPercent: 0, resetsAt: null }
  }
  return { usedPercent: Math.min(100, Math.max(0, window.usedPercent)), resetsAt: window.resetsAt }
}

/** Same email; a missing org on either side still matches (an older host may not know it). */
function clusterFor(clusters: Cluster[], orgKey: string | null): Cluster {
  const found =
    clusters.find((cluster) => orgKey !== null && cluster.orgKey === orgKey) ??
    clusters.find((cluster) => orgKey === null || cluster.orgKey === null)
  if (found) {
    if (found.orgKey === null && orgKey !== null) {
      found.orgKey = orgKey
    }
    return found
  }
  const cluster: Cluster = { orgKey, readings: [] }
  clusters.push(cluster)
  return cluster
}

function mergeCluster(cluster: Cluster, now: number): PooledAccount {
  const newestFirst = [...cluster.readings].sort(
    (a, b) => b.reading.updatedAt - a.reading.updatedAt
  )
  const pick = (kind: PooledLimitsWindowKind): PooledAccountWindow | null => {
    for (const { reading } of newestFirst) {
      const window = liveWindow(reading[kind], now)
      if (window) {
        return window
      }
    }
    return null
  }
  const freshest = newestFirst[0].reading
  return {
    provider: freshest.provider,
    label: freshest.label,
    plan: newestFirst.find(({ reading }) => reading.plan)?.reading.plan ?? null,
    session: pick('session'),
    weekly: pick('weekly'),
    updatedAt: freshest.updatedAt,
    machines: [...new Set(newestFirst.map(({ machine }) => machine))]
  }
}

function poolWindow(
  accounts: readonly PooledAccount[],
  kind: PooledLimitsWindowKind,
  now: number
): PooledLimitWindow | null {
  const windows = accounts
    .map((account) => account[kind])
    .filter((window): window is PooledAccountWindow => window !== null)
  if (windows.length === 0) {
    return null
  }
  const total = windows.reduce((sum, window) => sum + window.usedPercent, 0)
  const pending = windows.filter(
    (window) => window.usedPercent > 0 && window.resetsAt !== null && window.resetsAt > now
  )
  const nextResetAt =
    pending.length > 0 ? Math.min(...pending.map((window) => window.resetsAt as number)) : null
  const frees =
    nextResetAt === null
      ? 0
      : pending
          .filter((window) => (window.resetsAt as number) - nextResetAt <= SAME_RESET_MS)
          .reduce((sum, window) => sum + window.usedPercent, 0)
  return {
    kind,
    usedPercent: total / windows.length,
    accounts: windows.length,
    nextResetAt,
    freesPercent: frees / windows.length
  }
}

/** Dedupes accounts across machines by identity and pools each provider's windows. */
export function poolForkLimits(
  machines: readonly MachineReadings[],
  now: number
): PooledLimitsProviderRow[] {
  const byIdentity = new Map<string, Cluster[]>()
  for (const machine of machines) {
    for (const reading of machine.accounts) {
      const key = `${reading.provider}:${reading.emailKey}`
      const clusters = byIdentity.get(key) ?? []
      byIdentity.set(key, clusters)
      clusterFor(clusters, reading.orgKey).readings.push({ reading, machine: machine.machineName })
    }
  }
  const accounts = [...byIdentity.values()].flat().map((cluster) => mergeCluster(cluster, now))
  const rows: PooledLimitsProviderRow[] = []
  for (const provider of POOLED_LIMITS_PROVIDERS) {
    const mine = accounts
      .filter((account) => account.provider === provider)
      .sort((a, b) => a.label.localeCompare(b.label))
    if (mine.length === 0) {
      continue
    }
    const windows = POOLED_LIMITS_WINDOWS.map((kind) => poolWindow(mine, kind, now)).filter(
      (window): window is PooledLimitWindow => window !== null
    )
    rows.push({ provider, accounts: mine, windows })
  }
  return rows
}
