// Worktree ports (FORK.md, SLRM-2383): each workspace holds a block of ports on the host that runs
// it, so many workers on one machine do not fight over dev-server ports. The block is exported to
// the workspace's terminals, agents and setup scripts as ORCA_PORT (the first port), ORCA_PORT_0
// to ORCA_PORT_<n-1> and ORCA_PORT_COUNT. Setup scripts also get CONDUCTOR_PORT, the name imported
// Conductor scripts read. Settings, env names and the CLI line live here; the host keeps the
// reservations (`src/main/fork/worktree-ports/`).
// No node or electron imports: the CLI and main both read this file.

export const FORK_WORKTREE_PORTS_DEFAULT_COUNT = 10
export const FORK_WORKTREE_PORTS_MAX_COUNT = 100
/** Below Linux's (32768) and macOS's (49152) ephemeral ranges, above most dev-server defaults. */
export const FORK_WORKTREE_PORTS_DEFAULT_FROM = 20000
export const FORK_WORKTREE_PORTS_DEFAULT_TO = 29999
export const FORK_WORKTREE_PORTS_MIN_PORT = 1024
export const FORK_WORKTREE_PORTS_MAX_PORT = 65535

export type ForkWorktreePortsSettings = {
  /** Fork (SLRM-2383): each workspace gets a block of ports, exported as ORCA_PORT and ORCA_PORT_0..N-1 to its terminals, agents and setup scripts; unset is on. */
  forkWorktreePorts?: boolean
  /** Fork (SLRM-2383): ports in each workspace's block (1 to 100); a change applies to new blocks; unset is 10. */
  forkWorktreePortsCount?: number
  /** Fork (SLRM-2383): first port blocks are taken from (1024 to 65535); unset is 20000. */
  forkWorktreePortsFrom?: number
  /** Fork (SLRM-2383): last port blocks are taken from (1024 to 65535); unset is 29999. */
  forkWorktreePortsTo?: number
}

export type ForkWorktreePortsConfig = {
  enabled: boolean
  count: number
  from: number
  to: number
}

/** One workspace's reservation. */
export type ForkWorktreePortBlock = {
  worktreeId: string
  start: number
  count: number
  reservedAt: number
}

function intIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null
}

/** Any settings object; a hand-edited value out of range falls back to its default. */
export function readForkWorktreePortsSettings(settings: unknown): ForkWorktreePortsConfig {
  const source = typeof settings === 'object' && settings !== null ? settings : {}
  const read = (key: keyof ForkWorktreePortsSettings): unknown =>
    key in source ? Object.getOwnPropertyDescriptor(source, key)?.value : undefined
  const count =
    intIn(read('forkWorktreePortsCount'), 1, FORK_WORKTREE_PORTS_MAX_COUNT) ??
    FORK_WORKTREE_PORTS_DEFAULT_COUNT
  const min = FORK_WORKTREE_PORTS_MIN_PORT
  const max = FORK_WORKTREE_PORTS_MAX_PORT
  const from = intIn(read('forkWorktreePortsFrom'), min, max) ?? FORK_WORKTREE_PORTS_DEFAULT_FROM
  const to = intIn(read('forkWorktreePortsTo'), min, max) ?? FORK_WORKTREE_PORTS_DEFAULT_TO
  const enabled = read('forkWorktreePorts') !== false
  // A range that cannot hold one block is no range: both ends go back to their defaults.
  return to - from + 1 >= count
    ? { enabled, count, from, to }
    : {
        enabled,
        count,
        from: FORK_WORKTREE_PORTS_DEFAULT_FROM,
        to: FORK_WORKTREE_PORTS_DEFAULT_TO
      }
}

export const FORK_WORKTREE_PORT_ENV = 'ORCA_PORT'
export const FORK_WORKTREE_PORT_COUNT_ENV = 'ORCA_PORT_COUNT'
const PORT_ENV_KEY = /^ORCA_PORT(?:_COUNT|_\d+)?$/

/** True for every name this feature exports to terminals and agents. */
export function isForkWorktreePortEnvKey(key: string): boolean {
  return PORT_ENV_KEY.test(key)
}

/** The env a block exports to terminals and agents. */
export function forkWorktreePortBlockEnv(
  block: Pick<ForkWorktreePortBlock, 'start' | 'count'>
): Record<string, string> {
  const env: Record<string, string> = {
    [FORK_WORKTREE_PORT_ENV]: String(block.start),
    [FORK_WORKTREE_PORT_COUNT_ENV]: String(block.count)
  }
  for (let index = 0; index < block.count; index += 1) {
    env[`${FORK_WORKTREE_PORT_ENV}_${index}`] = String(block.start + index)
  }
  return env
}

/** Setup scripts also get CONDUCTOR_PORT, beside the CONDUCTOR_* names stock Orca already sets. */
export function forkWorktreePortSetupEnv(
  block: Pick<ForkWorktreePortBlock, 'start' | 'count'>
): Record<string, string> {
  return { ...forkWorktreePortBlockEnv(block), CONDUCTOR_PORT: String(block.start) }
}

/** The line `orca ports` prints under its scan. */
export function formatForkWorktreePortBlock(
  info: { enabled: boolean; block: Pick<ForkWorktreePortBlock, 'start' | 'count'> | null } | null
): string | null {
  if (!info) {
    return null
  }
  if (info.block) {
    const last = info.block.start + info.block.count - 1
    const range = info.block.count === 1 ? `${info.block.start}` : `${info.block.start}-${last}`
    return `reserved=${range} (ORCA_PORT=${info.block.start}, ORCA_PORT_0..${info.block.count - 1})${info.enabled ? '' : ' [off: not exported]'}`
  }
  return info.enabled
    ? 'reserved=(none yet; the next terminal, agent or setup script reserves a block)'
    : 'reserved=(off)'
}

/** WSLENV entries that carry the block into a WSL guest: plain numbers, never translated. */
export function forkWorktreePortWslenvEntries(env: Record<string, string | undefined>): string[] {
  return Object.keys(env)
    .filter((key) => isForkWorktreePortEnvKey(key) || key === 'CONDUCTOR_PORT')
    .map((key) => `${key}/u`)
}
