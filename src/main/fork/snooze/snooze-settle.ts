// Snooze (FORK.md, SLRM-2269): settling. A snooze set until merge or until some idle days settles
// when that comes true; the snooze ends and, when the user set one in the Settings screen, the
// cleanup command runs once. Only the desktop window's settle call gets here (snooze-ipc.ts): no
// RPC method, CLI command or paired client can start it, and none can set the command
// (`forkSnoozeSettleCommand` is a runs-command setting that `orca settings` refuses to write).
import { runProcess } from '@orca/process-host'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'
import {
  isForkSnoozeSettle,
  readForkSnoozeSettings,
  type ForkSnoozeEntry,
  type ForkSnoozeWakeReason
} from '../../../shared/fork/snooze'
import type {
  ForkSnoozeSettleContext,
  ForkSnoozeSettleOutcome
} from '../../../shared/fork/snooze-wire'
import type { ForkSnoozeStore } from './snooze-store'

/** How long the cleanup command may run before it is stopped. */
export const FORK_SNOOZE_SETTLE_TIMEOUT_MS = 5 * 60_000

type CommandOutcome = 'ok' | 'failed' | 'timeout'

function clip(value: string | undefined, max: number): string {
  // Control characters become spaces, so a value is always one plain line.
  return Array.from(value ?? '', (char) => {
    const code = char.charCodeAt(0)
    return code < 0x20 || code === 0x7f ? ' ' : char
  })
    .join('')
    .slice(0, max)
}

async function workingFolder(entry: ForkSnoozeEntry, path: string | undefined): Promise<string> {
  // A paired server's path means nothing here; such commands start in the home folder.
  if (entry.target.hostId !== 'local' || !path || !isAbsolute(path)) {
    return homedir()
  }
  try {
    return (await stat(path)).isDirectory() ? path : homedir()
  } catch {
    return homedir()
  }
}

/** The command's environment: what settled and why. Values are data, never part of the command. */
export function forkSnoozeSettleEnv(
  entry: ForkSnoozeEntry,
  reason: 'merged' | 'idle',
  context: ForkSnoozeSettleContext
): Record<string, string> {
  const { target } = entry
  return {
    ORCA_SNOOZE_ID: entry.id,
    ORCA_SNOOZE_KIND: target.kind,
    ORCA_SNOOZE_REASON: reason,
    ORCA_SNOOZE_HOST: target.hostId,
    ORCA_SNOOZE_WORKTREE_ID: target.worktreeId ?? '',
    ORCA_SNOOZE_PANE_KEY: target.kind === 'chat' ? target.paneKey : '',
    ORCA_SNOOZE_LABEL: clip(entry.label, 512),
    ORCA_SNOOZE_PATH: clip(context.path, 4096),
    ORCA_SNOOZE_BRANCH: clip(context.branch, 1024)
  }
}

/** The user's command through the system shell, as Node's `shell: true` would run it. */
function shellSpec(command: string): {
  program: string
  args: string[]
  windowsVerbatimArguments?: boolean
} {
  return process.platform === 'win32'
    ? {
        program: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', `"${command}"`],
        windowsVerbatimArguments: true
      }
    : { program: '/bin/sh', args: ['-c', command] }
}

export async function runForkSnoozeCommand(
  command: string,
  options: { cwd: string; env: Record<string, string>; payload: string; timeoutMs: number }
): Promise<CommandOutcome> {
  try {
    const result = await runProcess({
      ...shellSpec(command),
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      input: options.payload,
      timeoutMs: options.timeoutMs,
      // Output is not kept; a small cap stops a chatty command from holding memory.
      maxOutputBytes: 64 * 1024
    })
    if (result.timedOut) {
      return 'timeout'
    }
    return result.code === 0 ? 'ok' : 'failed'
  } catch {
    return 'failed'
  }
}

/**
 * End a snooze that settled. The reason must match how it was set (merged for until merge, idle
 * for until idle days); anything else ends nothing here. The command, if any, runs after the
 * snooze is gone, so a slow command never holds the sidebar.
 */
export async function settleForkSnooze(
  store: ForkSnoozeStore,
  settings: unknown,
  request: { id: string; reason: ForkSnoozeWakeReason; context: ForkSnoozeSettleContext },
  run: typeof runForkSnoozeCommand = runForkSnoozeCommand
): Promise<ForkSnoozeSettleOutcome> {
  const current = (await store.list()).find((entry) => entry.id === request.id)
  if (!current || !isForkSnoozeSettle(current.until, request.reason)) {
    return { woke: false, cleanup: 'none' }
  }
  const reason = request.reason
  const entry = await store.take(current.id)
  if (!entry) {
    return { woke: false, cleanup: 'none' }
  }
  const { settleCommand } = readForkSnoozeSettings(settings)
  // A paired device may hide things, but never aim the user's command at what it picked.
  if (!settleCommand || entry.noCleanup) {
    return { woke: true, cleanup: 'none' }
  }
  const env = forkSnoozeSettleEnv(entry, reason, request.context)
  const outcome = await run(settleCommand, {
    cwd: await workingFolder(entry, request.context.path),
    env,
    payload: JSON.stringify({
      ...entry,
      reason,
      path: env.ORCA_SNOOZE_PATH,
      branch: env.ORCA_SNOOZE_BRANCH
    }),
    timeoutMs: FORK_SNOOZE_SETTLE_TIMEOUT_MS
  })
  return { woke: true, cleanup: outcome }
}
