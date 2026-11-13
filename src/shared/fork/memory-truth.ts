// SLRM-2099: truthful memory. Whole process trees per session, the app's own total, system memory
// (used, compressed, swap, pressure) and a warning threshold. Shared by main, preload, renderer
// and the CLI; see FORK.md "Memory truth".

/** What a process in a session's tree is, by name and by where it sits in the tree. */
export type ForkMemoryCategory = 'agent' | 'tools' | 'shells' | 'other'

export type ForkMemoryBreakdown = Record<ForkMemoryCategory, number>

/** The per-process byte figure: macOS phys_footprint (includes compressed), Linux PSS plus
 *  swapped PSS, Windows private bytes; RSS or working set only when those are unreadable. */
export type ForkProcessMemoryMetric = 'footprint' | 'pss' | 'private-bytes' | 'rss' | 'working-set'

export type ForkSessionMemory = {
  kind: 'terminal' | 'chat'
  sessionId: string
  /** Agent name for chats (claude, codex, ...); null for terminals. */
  provider: string | null
  /** Top of the session's tree: the PTY's shell or the chat's provider process. */
  pid: number
  memory: number
  cpu: number
  processCount: number
  /** Processes that left the tree (reparented) but still belong to it. */
  orphanCount: number
  breakdown: ForkMemoryBreakdown
}

export type ForkWorkspaceMemory = {
  worktreeId: string
  worktreeName: string
  repoName: string
  memory: number
  cpu: number
  breakdown: ForkMemoryBreakdown
  sessions: ForkSessionMemory[]
}

export type ForkAppMemory = {
  total: number
  /** Electron's own processes (main, renderers, GPU, utility). */
  electron: number
  /** Other children of the app that belong to no session (git, language servers, helpers). */
  helpers: number
  /** The detached terminal host and anything under it that no session claimed. */
  terminalHost: number
}

export type ForkMemoryPressureLevel = 'normal' | 'warn' | 'critical' | 'unknown'

export type ForkSystemMemory = {
  total: number
  /** Activity Monitor's "Memory Used" on macOS (app + wired + compressed); total - available elsewhere. */
  used: number
  /** Memory the compressor occupies (macOS) or zswap holds (Linux); null when unknown. */
  compressed: number | null
  swapUsed: number | null
  swapTotal: number | null
  pressure: ForkMemoryPressureLevel
  sampledAt: number
}

export type ForkMemoryThresholdReason = 'pressure' | 'swap'

export type ForkMemoryStatus = {
  system: ForkSystemMemory | null
  /** True while system pressure or swap is past the warning threshold. */
  over: boolean
  reasons: ForkMemoryThresholdReason[]
  /** Over the threshold with the pause-launches setting on: new agent launches are refused. */
  launchesPaused: boolean
  settings: ForkMemorySettings
}

export type ForkMemoryTruth = {
  metric: ForkProcessMemoryMetric
  /** App plus every session tree plus unattributed terminals: what Orca really holds. */
  grandTotal: number
  app: ForkAppMemory
  workspaces: ForkWorkspaceMemory[]
  /** Sessions with no workspace (terminals the host could not place). */
  unattributed: ForkSessionMemory[]
  status: ForkMemoryStatus
}

// ---- Settings ----

export type ForkMemoryPressureThreshold = 'off' | 'warn' | 'critical'

export type ForkMemorySettings = {
  /** Warn once the system memory pressure reaches this level; 'off' ignores pressure. */
  warnPressure: ForkMemoryPressureThreshold
  /** Warn once swap in use reaches this many GB; 0 ignores swap. */
  warnSwapGb: number
  /** While over the threshold, refuse new agent launches. */
  pauseLaunches: boolean
  /** Seconds between background system memory checks (the popover samples on its own clock). */
  pollSeconds: number
}

export const FORK_MEMORY_SETTING_DEFAULTS: ForkMemorySettings = {
  warnPressure: 'warn',
  warnSwapGb: 8,
  pauseLaunches: false,
  pollSeconds: 15
}

export const FORK_MEMORY_POLL_SECONDS_MIN = 5
export const FORK_MEMORY_POLL_SECONDS_MAX = 600
export const FORK_MEMORY_SWAP_GB_MAX = 1024

/** The raw settings fields as they sit in GlobalSettings (all optional; unset means default). */
export type ForkMemoryGlobalSettings = {
  forkMemoryWarnPressure?: ForkMemoryPressureThreshold
  forkMemoryWarnSwapGb?: number
  forkMemoryPauseLaunches?: boolean
  forkMemoryPollSeconds?: number
}

function finiteIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

export function resolveForkMemorySettings(
  raw: ForkMemoryGlobalSettings | null | undefined
): ForkMemorySettings {
  const d = FORK_MEMORY_SETTING_DEFAULTS
  const pressure = raw?.forkMemoryWarnPressure
  return {
    warnPressure:
      pressure === 'off' || pressure === 'warn' || pressure === 'critical'
        ? pressure
        : d.warnPressure,
    warnSwapGb: finiteIn(raw?.forkMemoryWarnSwapGb, 0, FORK_MEMORY_SWAP_GB_MAX, d.warnSwapGb),
    pauseLaunches: raw?.forkMemoryPauseLaunches === true,
    pollSeconds: Math.round(
      finiteIn(
        raw?.forkMemoryPollSeconds,
        FORK_MEMORY_POLL_SECONDS_MIN,
        FORK_MEMORY_POLL_SECONDS_MAX,
        d.pollSeconds
      )
    )
  }
}

const PRESSURE_RANK: Record<ForkMemoryPressureLevel, number> = {
  unknown: 0,
  normal: 1,
  warn: 2,
  critical: 3
}

export function evaluateForkMemoryThreshold(
  system: ForkSystemMemory | null,
  settings: ForkMemorySettings
): { over: boolean; reasons: ForkMemoryThresholdReason[] } {
  const reasons: ForkMemoryThresholdReason[] = []
  if (system) {
    if (
      settings.warnPressure !== 'off' &&
      PRESSURE_RANK[system.pressure] >= PRESSURE_RANK[settings.warnPressure]
    ) {
      reasons.push('pressure')
    }
    if (
      settings.warnSwapGb > 0 &&
      system.swapUsed !== null &&
      system.swapUsed >= settings.warnSwapGb * 1024 ** 3
    ) {
      reasons.push('swap')
    }
  }
  return { over: reasons.length > 0, reasons }
}

export function buildForkMemoryStatus(
  system: ForkSystemMemory | null,
  settings: ForkMemorySettings
): ForkMemoryStatus {
  const { over, reasons } = evaluateForkMemoryThreshold(system, settings)
  return { system, over, reasons, launchesPaused: over && settings.pauseLaunches, settings }
}

export function emptyForkMemoryBreakdown(): ForkMemoryBreakdown {
  return { agent: 0, tools: 0, shells: 0, other: 0 }
}

// ---- IPC ----

export const FORK_MEMORY_CHANNELS = {
  /** main -> renderer: the status changed (threshold crossed, settings changed, new sample). */
  changed: 'fork:memory:changed',
  get: 'fork:memory:get'
} as const

export type ForkMemoryApi = {
  getStatus: () => Promise<ForkMemoryStatus>
  onChanged: (callback: (status: ForkMemoryStatus) => void) => () => void
}

// ---- Formatting (renderer and CLI) ----

export function formatForkBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}
