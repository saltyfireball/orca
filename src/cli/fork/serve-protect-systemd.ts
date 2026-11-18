// Server memory protection (SLRM-2384, FORK.md): what protect, unprotect and status read from
// systemd and /proc. Read-only: `systemctl show` on the user manager and on system units (which
// any user may read), and the oom_score_adj files in /proc.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { RuntimeClientError } from '../runtime/connection/types'
import { resolveLaunchUserDataPath } from '../runtime/profile/launch-user-data-path'
import { getPlatformUserDataPath } from '../runtime/profile/metadata'
import { renderServeService } from '../runtime/serve/supervision/serve-service-unit'
import {
  runServeServiceManager,
  type ServeServiceRun
} from '../../shared/remote-runtime/serve-supervisor/serve-service-unit-removal'
import { SERVE_PROTECT_DROP_IN } from '../../shared/fork/serve-protect'
import type { ServeProtectSystemFacts } from './serve-protect-root-steps'

export type ServeProtectDeps = {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  homeDir: string
  uid: number
  run: ServeServiceRun
  /** Reads a /proc file; null when it cannot. */
  readProc: (path: string) => string | null
}

export function defaultServeProtectDeps(): ServeProtectDeps {
  return {
    platform: process.platform,
    env: process.env,
    homeDir: homedir(),
    uid: process.getuid?.() ?? 0,
    run: runServeServiceManager,
    readProc: (path) => {
      try {
        return readFileSync(path, 'utf8')
      } catch {
        return null
      }
    }
  }
}

export type ServeProtectUnit = {
  name: string
  fragmentPath: string
  dropInPath: string
  slice: string | null
  sliceDropInPath: string | null
  mainPid: number | null
  /** As the manager reports them now. */
  oomScoreAdjust: string
  memoryMin: string
  memoryLow: string
  dropInPaths: string[]
}

function requireLinux(platform: NodeJS.Platform): void {
  if (platform !== 'linux') {
    throw new RuntimeClientError(
      'unsupported_platform',
      'Memory protection uses systemd and is Linux only. macOS launchd has no equivalent.'
    )
  }
}

/** The unit name `orca serve service install` gives this profile. */
export function serveProtectUnitName(deps: ServeProtectDeps): string {
  return renderServeService({
    platform: 'linux',
    homeDir: deps.homeDir,
    command: 'orca',
    userDataPath: resolveLaunchUserDataPath(deps.env),
    defaultUserDataPath: getPlatformUserDataPath('linux', deps.homeDir),
    path: ''
  }).name
}

function parseShow(out: string): Map<string, string> {
  const fields = new Map<string, string>()
  for (const line of out.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) {
      fields.set(line.slice(0, at), line.slice(at + 1).trim())
    }
  }
  return fields
}

async function show(
  deps: ServeProtectDeps,
  user: boolean,
  unit: string,
  properties: string[]
): Promise<Map<string, string> | null> {
  const args = [...(user ? ['--user'] : []), 'show', unit, `--property=${properties.join(',')}`]
  const result = await deps.run('systemctl', args)
  return result.code === 0 ? parseShow(result.out) : null
}

function insideHome(deps: ServeProtectDeps, path: string): boolean {
  const rel = relative(deps.homeDir, path)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith('/')
}

/** A slice name systemd would accept, or null for the manager's root slice. */
function safeSlice(value: string | undefined): string | null {
  return value && value !== '-.slice' && /^[A-Za-z0-9][A-Za-z0-9:_.\\-]*\.slice$/.test(value)
    ? value
    : null
}

/** The installed unit as the user manager sees it; throws when it is not installed. */
export async function readServeProtectUnit(deps: ServeProtectDeps): Promise<ServeProtectUnit> {
  requireLinux(deps.platform)
  const name = serveProtectUnitName(deps)
  const fields = await show(deps, true, name, [
    'LoadState',
    'FragmentPath',
    'DropInPaths',
    'MainPID',
    'Slice',
    'OOMScoreAdjust',
    'MemoryMin',
    'MemoryLow'
  ])
  if (!fields) {
    throw new RuntimeClientError(
      'service_manager_failed',
      '`systemctl --user` did not answer. Run this as the user that owns the service, in a session with a user manager.'
    )
  }
  const fragmentPath = fields.get('FragmentPath') ?? ''
  if (fields.get('LoadState') !== 'loaded' || !fragmentPath) {
    throw new RuntimeClientError(
      'not_installed',
      `${name} is not installed. Install it first with \`orca serve service install\`.`
    )
  }
  // A unit in the user's own config folder gets its drop-in beside it; elsewhere, the user's
  // own config folder still applies to it.
  const configDir = insideHome(deps, fragmentPath)
    ? dirname(fragmentPath)
    : join(deps.homeDir, '.config', 'systemd', 'user')
  const slice = safeSlice(fields.get('Slice'))
  return {
    name,
    fragmentPath,
    dropInPath: join(configDir, `${name}.d`, SERVE_PROTECT_DROP_IN),
    slice,
    sliceDropInPath: slice ? join(configDir, `${slice}.d`, SERVE_PROTECT_DROP_IN) : null,
    mainPid: Number(fields.get('MainPID')) || null,
    oomScoreAdjust: fields.get('OOMScoreAdjust') ?? '',
    memoryMin: fields.get('MemoryMin') ?? '',
    memoryLow: fields.get('MemoryLow') ?? '',
    dropInPaths: (fields.get('DropInPaths') ?? '').split(/\s+/).filter(Boolean)
  }
}

export function procScore(deps: ServeProtectDeps, pid: number | null): number | null {
  if (!pid) {
    return null
  }
  const text = deps.readProc(`/proc/${pid}/oom_score_adj`)?.trim() ?? ''
  return /^-?\d+$/.test(text) ? Number(text) : null
}

/**
 * The lowest score the user manager can give its units: its own (an unprivileged process may not
 * go below the score it was started with). Null when it cannot be read.
 */
export async function readUserManagerFloor(deps: ServeProtectDeps): Promise<number | null> {
  const fields = await show(deps, false, `user@${deps.uid}.service`, ['MainPID'])
  return procScore(deps, Number(fields?.get('MainPID')) || null)
}

export async function readSystemFacts(deps: ServeProtectDeps): Promise<ServeProtectSystemFacts> {
  const units: ServeProtectSystemFacts['units'] = []
  for (const unit of [
    'user.slice',
    `user-${deps.uid}.slice`,
    `user@${deps.uid}.service`,
    'tailscaled.service',
    'ssh.service',
    'sshd.service'
  ]) {
    const fields = await show(deps, false, unit, [
      'LoadState',
      'MemoryMin',
      'MemoryLow',
      'OOMScoreAdjust',
      'MainPID'
    ])
    if (fields?.get('LoadState') === 'loaded') {
      units.push({
        unit,
        memoryMin: fields.get('MemoryMin') ?? '',
        memoryLow: fields.get('MemoryLow') ?? '',
        oomScoreAdjust: fields.get('OOMScoreAdjust') ?? ''
      })
    }
  }
  return { uid: deps.uid, units }
}

export async function readServeProtectStatus(
  deps: ServeProtectDeps = defaultServeProtectDeps()
): Promise<Record<string, unknown>> {
  const unit = await readServeProtectUnit(deps)
  const facts = await readSystemFacts(deps)
  return {
    name: unit.name,
    protected: existsSync(unit.dropInPath),
    dropInPath: unit.dropInPath,
    dropInLoaded: unit.dropInPaths.includes(unit.dropInPath),
    configured: {
      oomScoreAdjust: unit.oomScoreAdjust,
      memoryMin: unit.memoryMin,
      memoryLow: unit.memoryLow
    },
    serverOomScore: procScore(deps, unit.mainPid),
    userManagerFloor: await readUserManagerFloor(deps),
    system: facts.units
  }
}
