// Completion contract (BAD-676, FORK.md): runs one done check in the worker's workspace, on the
// host that workspace lives on. The command is only ever text the coordinator put in the Task's
// spec; nothing a worker wrote reaches a shell. Output is merged, capped and kept as a tail.
import { spawn, type ChildProcess } from 'node:child_process'
import type { ForkDoneCheckResult } from '../../../shared/fork/completion-contract'
import { tailLines } from '../../../shared/fork/completion-contract'

/** Where a workspace's commands run. `ssh` and `wsl` are decided by the workspace's own repo. */
export type CheckTarget = {
  cwd: string
  connectionId: string | null
  wslDistro?: string
}

export type CheckRunOptions = { timeoutMs: number; outputLines: number }

/** A runner returns the exit code and merged output; it never throws for a failing command. */
export type RawRun = { exitCode: number | null; output: string; timedOut: boolean }
export type CheckRunner = (
  target: CheckTarget,
  command: string,
  timeoutMs: number
) => Promise<RawRun>

const MAX_CAPTURE_BYTES = 512 * 1024

/** Keeps the last MAX_CAPTURE_BYTES so a noisy check cannot grow Orca's memory. */
function appendCapped(current: string, chunk: string): string {
  const next = current + chunk
  return next.length > MAX_CAPTURE_BYTES ? next.slice(next.length - MAX_CAPTURE_BYTES) : next
}

export function localShellArgv(
  target: CheckTarget,
  command: string,
  platform: NodeJS.Platform = process.platform
): { file: string; args: string[]; cwd?: string } {
  if (target.wslDistro) {
    return {
      file: 'wsl.exe',
      args: ['-d', target.wslDistro, '--cd', target.cwd, '--', 'sh', '-c', command]
    }
  }
  if (platform === 'win32') {
    return {
      file: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', command],
      cwd: target.cwd
    }
  }
  return { file: '/bin/sh', args: ['-c', command], cwd: target.cwd }
}

/**
 * Ends the command this call started, and what it started, now. Off Windows the command leads its
 * own process group (spawned `detached`), so signalling the group by the child's pid also reaches
 * what a shell like dash runs as a child instead of replacing itself. The group is the one this
 * call created: callers only pass a child they spawned detached, and only while it has not exited
 * (afterwards its pid may belong to another process). On Windows `taskkill /t` does the same.
 */
export function killCheckTree(child: ChildProcess, hasExited: () => boolean): void {
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
      killer.on('error', () => child.kill('SIGKILL'))
      killer.unref()
    } catch {
      child.kill('SIGKILL')
    }
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

/** This computer, and WSL through wsl.exe. */
export const localCheckRunner: CheckRunner = (target, command, timeoutMs) =>
  new Promise((resolve) => {
    const { file, args, cwd } = localShellArgv(target, command)
    let output = ''
    let timedOut = false
    let settled = false
    const finish = (exitCode: number | null): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve({ exitCode, output, timedOut })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(file, args, {
        cwd,
        env: { ...process.env, CI: process.env.CI ?? '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        // Its own process group off Windows, so the deadline can end the whole command.
        detached: process.platform !== 'win32',
        windowsHide: true
      })
    } catch (error) {
      output = error instanceof Error ? error.message : String(error)
      resolve({ exitCode: null, output, timedOut: false })
      return
    }
    let exited = false
    child.once('exit', () => {
      exited = true
    })
    // Only the child this call started, and its own process group, are ever killed.
    const timer = setTimeout(() => {
      timedOut = true
      killCheckTree(child, () => exited)
      // A stray grandchild in another group may still hold the pipes: settle without waiting.
      child.stdout?.destroy()
      child.stderr?.destroy()
      finish(null)
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      output = appendCapped(output, chunk.toString('utf8'))
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output = appendCapped(output, chunk.toString('utf8'))
    })
    child.on('error', (error) => {
      output = appendCapped(output, error.message)
      finish(null)
    })
    child.on('close', (code) => finish(timedOut ? null : code))
  })

const EXIT_MARKER = '__ORCA_DONE_CHECK_EXIT__:'

function posixQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`
}

/** The remote shell line for an SSH workspace; the marker carries the exit code back. */
export function sshCheckCommand(cwd: string, command: string): string {
  return `cd ${posixQuote(cwd)} && { (${command}) 2>&1; printf '\\n${EXIT_MARKER}%s\\n' "$?"; }`
}

export function parseSshCheckOutput(stdout: string): { exitCode: number | null; output: string } {
  const at = stdout.lastIndexOf(EXIT_MARKER)
  if (at === -1) {
    return { exitCode: null, output: stdout }
  }
  const code = Number.parseInt(stdout.slice(at + EXIT_MARKER.length), 10)
  return { exitCode: Number.isInteger(code) ? code : null, output: stdout.slice(0, at) }
}

/** An SSH workspace, through the app's own connection to it. */
export const sshCheckRunner: CheckRunner = async (target, command, timeoutMs) => {
  const [{ getSshConnectionManager }, { execCommand }] = await Promise.all([
    import('../../ssh/targets/ssh-target-registry'),
    import('../../ssh/remote-exec/remote-exec-command')
  ])
  const conn = target.connectionId
    ? getSshConnectionManager()?.getConnection(target.connectionId)
    : undefined
  if (!conn) {
    return {
      exitCode: null,
      output: 'The SSH connection to this workspace is not open.',
      timedOut: false
    }
  }
  try {
    const stdout = await execCommand(conn, sshCheckCommand(target.cwd, command), { timeoutMs })
    return { ...parseSshCheckOutput(stdout), timedOut: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: null, output: message, timedOut: /timed? ?out/iu.test(message) }
  }
}

/** The runner for a workspace: SSH when it lives on an SSH target, else this computer. */
export function checkRunnerFor(target: CheckTarget): CheckRunner {
  return target.connectionId ? sshCheckRunner : localCheckRunner
}

export async function runDoneCheck(
  runner: CheckRunner,
  target: CheckTarget,
  command: string,
  options: CheckRunOptions
): Promise<ForkDoneCheckResult> {
  const started = Date.now()
  const raw = await runner(target, command, options.timeoutMs)
  return {
    check: command,
    ok: raw.exitCode === 0 && !raw.timedOut,
    exitCode: raw.exitCode,
    output: tailLines(raw.output, options.outputLines),
    ...(raw.timedOut ? { timedOut: true } : {}),
    durationMs: Date.now() - started
  }
}
