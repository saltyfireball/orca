// Idle recovery (FORK.md), item C: runs the user's classifier command.
// Contract: with `settings.classifierCommand` set, run it with the input as one JSON object on
// stdin, stop it after `settings.classifierTimeoutSeconds`, and read stdout through
// `parseIdleRecoveryVerdict` (ceiling: `settings.recheckMaxMinutes`). A failed start, a non-zero
// exit, a timeout or unreadable output is 'finished'. With no command, answer with the built-in
// classifier. Never throws.
//
// The command is one shell line (`shell: true`), the way automation prechecks run theirs, so
// a pipe or a quoted argument works as it does in a terminal. Stdin and stdout hold chat text:
// neither is logged, and a failure is reported only as a short fixed reason in the verdict.
import { spawn, type ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'
import {
  parseIdleRecoveryVerdict,
  tailForIdleRecoveryClassifier,
  type IdleRecoveryClassifierInput,
  type IdleRecoveryVerdict
} from '../../../shared/fork/idle-recovery'
import type { IdleRecoverySettings } from '../../../shared/fork/idle-recovery-settings'
import { classifyIdleRecoveryBuiltin } from './idle-recovery-builtin'

/** A verdict is a few short fields; anything past this is not one. */
export const IDLE_RECOVERY_CLASSIFIER_MAX_STDOUT_BYTES = 64 * 1024
/** How long a stopped command gets to exit on its own before it is killed outright. */
const FORCE_KILL_AFTER_MS = 2000

function finished(reason: string): IdleRecoveryVerdict {
  return { verdict: 'finished', reason, question: '', nextStep: '', wakeAfterSeconds: 0 }
}

/**
 * Stops the command this call started and nothing else. Off Windows the command leads its own
 * process group (`detached`), so signalling the group by the child's pid also reaches what the
 * shell line started. On Windows `taskkill /t` does the same for the child's pid.
 */
function stopClassifier(child: ChildProcess, hasExited: () => boolean): void {
  const pid = child.pid
  if (!pid || hasExited()) {
    return
  }
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true
      })
      killer.on('error', () => child.kill())
      killer.unref()
    } catch {
      child.kill()
    }
    return
  }
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      process.kill(-pid, signal)
    } catch {
      child.kill(signal)
    }
  }
  signalGroup('SIGTERM')
  const forceKill = setTimeout(() => {
    // Only while the child has not been reaped: after that its pid may belong to another process.
    if (!hasExited()) {
      signalGroup('SIGKILL')
    }
  }, FORCE_KILL_AFTER_MS)
  forceKill.unref?.()
  child.once('exit', () => clearTimeout(forceKill))
}

function runClassifierCommand(
  command: string,
  input: IdleRecoveryClassifierInput,
  settings: IdleRecoverySettings,
  signal: AbortSignal | undefined
): Promise<IdleRecoveryVerdict> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(finished('classifier was cancelled'))
      return
    }
    let child: ChildProcess
    try {
      child = spawn(command, {
        cwd: homedir(),
        detached: process.platform !== 'win32',
        env: process.env,
        shell: true,
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true
      })
    } catch {
      resolve(finished('classifier command could not be started'))
      return
    }

    const chunks: Buffer[] = []
    let stdoutBytes = 0
    let exited = false
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | null = null

    const onAbort = (): void => settle(finished('classifier was cancelled'), true)
    function settle(verdict: IdleRecoveryVerdict, stop: boolean): void {
      if (settled) {
        return
      }
      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      signal?.removeEventListener('abort', onAbort)
      if (stop) {
        stopClassifier(child, () => exited)
      }
      resolve(verdict)
    }

    timeout = setTimeout(
      () => settle(finished('classifier command timed out'), true),
      settings.classifierTimeoutSeconds * 1000
    )
    signal?.addEventListener('abort', onAbort, { once: true })

    child.once('exit', () => {
      exited = true
    })
    child.once('error', () => settle(finished('classifier command could not be started'), true))
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > IDLE_RECOVERY_CLASSIFIER_MAX_STDOUT_BYTES) {
        settle(finished('classifier output was too large'), true)
        return
      }
      chunks.push(chunk)
    })
    child.once('close', (code) => {
      if (code !== 0) {
        settle(finished('classifier command failed'), false)
        return
      }
      settle(
        parseIdleRecoveryVerdict(
          Buffer.concat(chunks).toString('utf8'),
          settings.recheckMaxMinutes * 60
        ),
        false
      )
    })

    // A command that exits without reading its input closes the pipe: that is its exit code's
    // story to tell, not an error of ours.
    child.stdin?.on('error', () => {})
    child.stdin?.end(JSON.stringify(input))
  })
}

export async function classifyIdleRecoveryEnding(
  input: IdleRecoveryClassifierInput,
  settings: IdleRecoverySettings,
  signal?: AbortSignal
): Promise<IdleRecoveryVerdict> {
  try {
    if (settings.mode === 'off') {
      // The sweep does not call this while off; should anything else, no process is started.
      return finished('idle recovery is off')
    }
    const command = settings.classifierCommand?.trim()
    if (!command) {
      return classifyIdleRecoveryBuiltin(input)
    }
    const shown: IdleRecoveryClassifierInput = {
      ...input,
      last_assistant_message: tailForIdleRecoveryClassifier(input.last_assistant_message)
    }
    return await runClassifierCommand(command, shown, settings, signal)
  } catch {
    return finished('classifier could not be run')
  }
}
