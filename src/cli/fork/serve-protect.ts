// Server memory protection (SLRM-2384, FORK.md): `orca serve service protect|unprotect` and
// `protect status`. Linux only. It writes a drop-in next to the orca-serve user unit, whichever
// installer wrote the unit (`orca serve service install` or the dotfiles `orca-server`; both use
// the same unit names), plus one for the unit's slice, reloads the user manager and applies the
// memory values at once. It never edits the unit itself, never restarts it, and never runs a root
// step: those (protection up the slice tree, tailscaled and sshd) are printed for the user.
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  renderServeProtectDropIn,
  renderServeProtectSliceDropIn,
  SERVE_PROTECT_MARKER,
  type ServeProtectValues
} from '../../shared/fork/serve-protect'
import { serveProtectRootSteps } from './serve-protect-root-steps'
import {
  defaultServeProtectDeps,
  readServeProtectUnit,
  readSystemFacts,
  readUserManagerFloor,
  type ServeProtectDeps
} from './serve-protect-systemd'

export { readServeProtectStatus } from './serve-protect-systemd'

/** A symlink is never ours: protect writes plain files only. */
function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

function writeOurs(path: string, content: string): void {
  if (isLink(path)) {
    throw new RuntimeClientError('conflict', `${path} is a symlink; move it away first.`)
  }
  if (existsSync(path) && !readFileSync(path, 'utf8').startsWith(SERVE_PROTECT_MARKER)) {
    throw new RuntimeClientError(
      'conflict',
      `${path} exists and was not written by \`orca serve service protect\`; move it away first.`
    )
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, { mode: 0o644 })
}

function removeOurs(path: string | null): boolean {
  if (
    !path ||
    isLink(path) ||
    !existsSync(path) ||
    !readFileSync(path, 'utf8').startsWith(SERVE_PROTECT_MARKER)
  ) {
    return false
  }
  rmSync(path, { force: true })
  return true
}

async function mustRun(deps: ServeProtectDeps, args: string[]): Promise<void> {
  const result = await deps.run('systemctl', args)
  if (result.code !== 0) {
    throw new RuntimeClientError(
      'service_manager_failed',
      `\`systemctl ${args.join(' ')}\` failed: ${result.out.trim() || `exit ${String(result.code)}`}`
    )
  }
}

/** Memory values applied now, at runtime only (the drop-in keeps them across reboots). */
function memoryAssignments(values: Pick<ServeProtectValues, 'memoryMin' | 'memoryLow'>): string[] {
  return [`MemoryMin=${values.memoryMin ?? '0'}`, `MemoryLow=${values.memoryLow ?? '0'}`]
}

export type ServeProtectOptions = Omit<ServeProtectValues, 'oomScoreAdjust'> & {
  /** A score, `auto` (the user manager's own, the lowest it can set), or null for none. */
  oomScoreAdjust: number | 'auto' | null
  systemOomScoreAdjust: number
  dryRun: boolean
}

export async function protectServeService(
  options: ServeProtectOptions,
  deps: ServeProtectDeps = defaultServeProtectDeps()
): Promise<Record<string, unknown>> {
  const unit = await readServeProtectUnit(deps)
  const floor = await readUserManagerFloor(deps)
  const notes: string[] = []
  let oomScoreAdjust = options.oomScoreAdjust === 'auto' ? floor : options.oomScoreAdjust
  if (options.oomScoreAdjust === 'auto' && floor === null) {
    notes.push(
      "OOMScoreAdjust is left unset: the user manager's own score could not be read. Pass --oom-score-adjust <n> to set one."
    )
  }
  if (typeof oomScoreAdjust === 'number' && floor !== null && oomScoreAdjust < floor) {
    notes.push(
      `The user manager cannot go below its own score (${floor}), so OOMScoreAdjust is ${floor}.`
    )
    oomScoreAdjust = floor
  }
  const values: ServeProtectValues = { ...options, oomScoreAdjust }
  if (
    values.childOomScoreAdjust !== null &&
    oomScoreAdjust !== null &&
    values.childOomScoreAdjust <= oomScoreAdjust
  ) {
    notes.push('The child score is not above the server score, so agents keep the server score.')
  }
  const content = renderServeProtectDropIn(values)
  const sliceContent = unit.sliceDropInPath ? renderServeProtectSliceDropIn(values) : null
  const rootSteps = serveProtectRootSteps(
    await readSystemFacts(deps),
    values,
    options.systemOomScoreAdjust
  )
  const base = {
    name: unit.name,
    dropInPath: unit.dropInPath,
    content,
    sliceDropInPath: sliceContent ? unit.sliceDropInPath : null,
    sliceContent,
    rootSteps,
    notes
  }
  if (options.dryRun) {
    return { protected: false, dryRun: true, ...base }
  }
  writeOurs(unit.dropInPath, content)
  if (unit.sliceDropInPath) {
    if (sliceContent) {
      writeOurs(unit.sliceDropInPath, sliceContent)
    } else {
      removeOurs(unit.sliceDropInPath)
    }
  }
  await mustRun(deps, ['--user', 'daemon-reload'])
  // Memory protection takes effect now; the scores wait for the next start of the service.
  const live = memoryAssignments(values)
  await mustRun(deps, ['--user', 'set-property', '--runtime', unit.name, ...live])
  if (unit.slice && sliceContent) {
    await mustRun(deps, ['--user', 'set-property', '--runtime', unit.slice, ...live])
  }
  return {
    protected: true,
    dryRun: false,
    ...base,
    restartCommand: `systemctl --user restart ${unit.name}`
  }
}

export async function unprotectServeService(
  deps: ServeProtectDeps = defaultServeProtectDeps()
): Promise<Record<string, unknown>> {
  const unit = await readServeProtectUnit(deps)
  const removed = removeOurs(unit.dropInPath)
  const sliceRemoved = removeOurs(unit.sliceDropInPath)
  if (removed || sliceRemoved) {
    await mustRun(deps, ['--user', 'daemon-reload'])
    const none = memoryAssignments({ memoryMin: null, memoryLow: null })
    await mustRun(deps, ['--user', 'set-property', '--runtime', unit.name, ...none])
    if (unit.slice && sliceRemoved) {
      await mustRun(deps, ['--user', 'set-property', '--runtime', unit.slice, ...none])
    }
  }
  return {
    removed,
    name: unit.name,
    dropInPath: unit.dropInPath,
    sliceDropInPath: sliceRemoved ? unit.sliceDropInPath : null,
    restartCommand: `systemctl --user restart ${unit.name}`
  }
}
