// Server memory protection (SLRM-2384, FORK.md): `orca serve service protect` writes a systemd
// drop-in for the orca-serve user unit so the server is the last thing the kernel reclaims or
// OOM-kills when agents use up memory, and agents are the first. The drop-in's shape and the
// checks on its values, shared by the CLI that writes it and the terminal daemon that reads the
// child value from its environment.

/** The drop-in's file name, the same under the unit and under its slice. */
export const SERVE_PROTECT_DROP_IN = '50-blackfish-protect.conf'
/** First line of every file protect writes; unprotect removes only files that start with it. */
export const SERVE_PROTECT_MARKER =
  '# Written by `orca serve service protect` (Blackfish, SLRM-2384).'
/**
 * The terminal daemon raises its own oom_score_adj to this at start, so the agents it runs are
 * killed before the server it was started by. Raising needs no privilege.
 */
export const SERVE_PROTECT_CHILD_OOM_ENV = 'ORCA_FORK_CHILD_OOM_SCORE_ADJ'

export const SERVE_PROTECT_DEFAULT_MEMORY_MIN = '256M'
export const SERVE_PROTECT_DEFAULT_MEMORY_LOW = '1G'
export const SERVE_PROTECT_DEFAULT_CHILD_OOM = 300
/** What the printed root steps give tailscaled and sshd: rarely killed, never immune. */
export const SERVE_PROTECT_DEFAULT_SYSTEM_OOM = -500

export type ServeProtectValues = {
  /** systemd size (`256M`), or null to leave MemoryMin unset. */
  memoryMin: string | null
  memoryLow: string | null
  /** The unit's OOMScoreAdjust, or null to leave it unset. */
  oomScoreAdjust: number | null
  /** The terminal daemon's own score, or null to leave it as inherited. */
  childOomScoreAdjust: number | null
}

/** A systemd memory size: digits with an optional K, M, G or T; `off` is null. Else undefined. */
export function parseServeProtectSize(raw: string): string | null | undefined {
  const value = raw.trim()
  if (value.toLowerCase() === 'off') {
    return null
  }
  const match = /^(\d{1,15})([KMGT]?)$/i.exec(value)
  return match ? `${match[1]}${match[2].toUpperCase()}` : undefined
}

/** An oom_score_adj from -1000 to 1000; `off` is null. Else undefined. */
export function parseServeProtectOomScore(raw: string): number | null | undefined {
  const value = raw.trim()
  if (value.toLowerCase() === 'off') {
    return null
  }
  if (!/^-?\d{1,4}$/.test(value)) {
    return undefined
  }
  const score = Number(value)
  return score >= -1000 && score <= 1000 ? score : undefined
}

/** The unit's drop-in. Every value went through the parsers above, so none can break a line. */
export function renderServeProtectDropIn(values: ServeProtectValues): string {
  const lines = [
    SERVE_PROTECT_MARKER,
    '# Remove it with `orca serve service unprotect`.',
    '[Service]'
  ]
  if (values.oomScoreAdjust !== null) {
    lines.push(`OOMScoreAdjust=${values.oomScoreAdjust}`)
  }
  if (values.memoryMin !== null) {
    lines.push(`MemoryMin=${values.memoryMin}`)
  }
  if (values.memoryLow !== null) {
    lines.push(`MemoryLow=${values.memoryLow}`)
  }
  if (values.childOomScoreAdjust !== null) {
    lines.push(`Environment=${SERVE_PROTECT_CHILD_OOM_ENV}=${values.childOomScoreAdjust}`)
  }
  return `${lines.join('\n')}\n`
}

/** The slice's drop-in: a child's protection never exceeds what its parent slice holds. */
export function renderServeProtectSliceDropIn(values: ServeProtectValues): string | null {
  if (values.memoryMin === null && values.memoryLow === null) {
    return null
  }
  const lines = [
    SERVE_PROTECT_MARKER,
    '# Remove it with `orca serve service unprotect`.',
    '[Slice]'
  ]
  if (values.memoryMin !== null) {
    lines.push(`MemoryMin=${values.memoryMin}`)
  }
  if (values.memoryLow !== null) {
    lines.push(`MemoryLow=${values.memoryLow}`)
  }
  return `${lines.join('\n')}\n`
}

/** The child score from the daemon's environment, when it is a valid score. */
export function serveProtectChildOomFromEnv(env: NodeJS.ProcessEnv): number | null {
  const raw = env[SERVE_PROTECT_CHILD_OOM_ENV]
  if (raw === undefined) {
    return null
  }
  return parseServeProtectOomScore(raw) ?? null
}
