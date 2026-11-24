// BAD-764: runs one app instance of a guarded chat as its own process (the app-instance or
// survive-owner fixture), so a test can end it and start the next. Each prints one JSON event per
// stdout line and takes commands on stdin.
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { expect, vi } from 'vitest'

const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
// The app this test may itself run in must not reach the chat.
const HOST_ENV =
  /^(?:ORCA_|CLAUDE_CODE_|CLAUDECODE$|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_AGENT_SDK_|VITEST)/

export type GuardAppEvent = Record<string, unknown> & { ev: string }

const apps: ChildProcess[] = []
const brokers = new Set<number>()

/** A broker the test started; it stops its Claude on SIGTERM. */
export function ownGuardBroker(pid: number): void {
  brokers.add(pid)
}

/** Ends only processes the test started, by their own pids. */
export function endGuardApps(): void {
  for (const child of apps.splice(0)) {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      process.kill(child.pid, 'SIGKILL')
    }
  }
  for (const pid of brokers) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
  brokers.clear()
}

export function startGuardApp(fixture: string, env: Record<string, string>, timeout = 30_000) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !HOST_ENV.test(key))
  )
  const child = spawn('node', ['--import', tsxLoader, fixture], {
    env: { ...inherited, ...env },
    stdio: ['pipe', 'pipe', 'inherit']
  })
  apps.push(child)
  const events: GuardAppEvent[] = []
  let partial = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    const lines = (partial + chunk.toString('utf8')).split('\n')
    partial = lines.pop() ?? ''
    events.push(...lines.map((line): GuardAppEvent => JSON.parse(line)))
  })
  const seen = (ev: string): GuardAppEvent[] => events.filter((event) => event.ev === ev)
  const send = (line: string): void => void child.stdin?.write(`${line}\n`)
  const next = async (ev: string, after = 0): Promise<GuardAppEvent> => {
    await vi.waitFor(
      () => {
        if (seen('error').length > 0) {
          throw new Error(JSON.stringify(seen('error')[0]))
        }
        expect(seen(ev).length, JSON.stringify(events.slice(-6))).toBeGreaterThan(after)
      },
      { timeout, interval: 25 }
    )
    return seen(ev)[after]
  }
  /** Sends a command and returns the event that answers it. */
  const ask = (line: string, ev: string): Promise<GuardAppEvent> => {
    const before = seen(ev).length
    send(line)
    return next(ev, before)
  }
  const kill = async (): Promise<void> => {
    const gone = new Promise((resolve) => child.once('exit', resolve))
    process.kill(child.pid ?? -1, 'SIGKILL')
    await gone
  }
  return { seen, send, next, ask, kill }
}

/** The status's row of one surface. */
export function guardSurfaceRow(status: Record<string, unknown>, surface = 'native-chat'): unknown {
  return (Array.isArray(status.surfaces) ? status.surfaces : []).find(
    (entry: { surface?: unknown }) => entry.surface === surface
  )
}
