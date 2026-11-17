// Server updates (FORK.md, SLRM-2310): restart the service onto the new install, and put the old
// one back when the new one does not come up. A small shell watchdog does both: it is started in
// its own session (detached), so the service manager stopping this server does not stop it, and
// it outlives the restart to watch for the new server's ready mark. Values reach the script only
// as positional arguments, never inside its text.
import { spawnProcess } from '@orca/process-host'
import type { ForkServeService } from './server-update-install'

/** The service manager command that restarts the service (the server and its supervisor). */
export function forkServiceRestartArgv(service: ForkServeService, uid: number): string[] {
  return service.manager === 'launchd'
    ? ['/bin/launchctl', 'kickstart', '-k', `gui/${uid}/${service.name}`]
    : ['systemctl', '--user', 'restart', service.name]
}

/**
 * $1 ready mark file, $2 the text it must hold, $3 seconds to wait, $4 1 to roll back,
 * $5 install, $6 previous, $7 where a failed install goes, $8 the supervisor's brake file,
 * then the restart command. Exit 0: the new server came up (or no rollback was asked for).
 */
export const FORK_UPDATE_WATCHDOG_SCRIPT = [
  'mark=$1; want=$2; wait=$3; rollback=$4; install=$5; previous=$6; failed=$7; brake=$8',
  'shift 8',
  'rm -f "$brake"',
  '"$@" >/dev/null 2>&1',
  'n=0',
  'while [ "$n" -lt "$wait" ]; do',
  '  if [ -f "$mark" ] && [ "$(cat "$mark")" = "$want" ]; then exit 0; fi',
  '  sleep 1; n=$((n + 1))',
  'done',
  '[ "$rollback" = 1 ] || exit 0',
  '[ -d "$previous" ] || exit 3',
  'rm -rf "$failed"',
  'mv "$install" "$failed" || exit 4',
  'if ! mv "$previous" "$install"; then mv "$failed" "$install"; exit 5; fi',
  'rm -f "$brake"',
  '"$@" >/dev/null 2>&1',
  'exit 2'
].join('\n')

export type ForkUpdateWatchdog = {
  readyMark: string
  want: string
  readySeconds: number
  rollback: boolean
  installPath: string
  previousPath: string
  failedPath: string
  brakePath: string
  restart: readonly string[]
}

export function forkUpdateWatchdogArgs(watchdog: ForkUpdateWatchdog): string[] {
  return [
    '-c',
    FORK_UPDATE_WATCHDOG_SCRIPT,
    'orca-server-update',
    watchdog.readyMark,
    watchdog.want,
    String(Math.max(1, Math.round(watchdog.readySeconds))),
    watchdog.rollback ? '1' : '0',
    watchdog.installPath,
    watchdog.previousPath,
    watchdog.failedPath,
    watchdog.brakePath,
    ...watchdog.restart
  ]
}

export type ForkSpawnDetached = (program: string, args: string[]) => void

export const spawnForkDetached: ForkSpawnDetached = (program, args) => {
  const child = spawnProcess({ program, args, detached: true, stdio: 'ignore' })
  child.once('error', (error) => {
    console.error('[fork-server-update] the restart watchdog did not start:', error)
  })
  child.unref()
}

export function startForkUpdateWatchdog(
  watchdog: ForkUpdateWatchdog,
  spawnImpl: ForkSpawnDetached = spawnForkDetached
): void {
  spawnImpl('/bin/sh', forkUpdateWatchdogArgs(watchdog))
}
