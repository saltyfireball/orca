// SLRM-1394: at startup, the records and sockets of brokers that are gone. A broker that ends
// cleanly removes its own; one killed outright leaves them behind, and a record holds a token.
// Only what a record names is touched: sockets of other Orca builds share the temp folder.
import { chmodSync, existsSync, lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const SOCKET_DIR_NAME = 'orca-chat-survive'

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: some process holds the pid, so it is not ours to judge.
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

function readRecord(path: string): { brokerPid: number | null; socketPath: string | null } {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const pid: unknown = typeof raw === 'object' && raw ? Reflect.get(raw, 'brokerPid') : null
    const socket: unknown = typeof raw === 'object' && raw ? Reflect.get(raw, 'socketPath') : null
    return {
      brokerPid: typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 ? pid : null,
      socketPath: typeof socket === 'string' ? socket : null
    }
  } catch {
    return { brokerPid: null, socketPath: null }
  }
}

function removeSocket(path: string | null): void {
  if (!path || basename(dirname(path)) !== SOCKET_DIR_NAME || !path.endsWith('.sock')) {
    return
  }
  try {
    if (lstatSync(path).isSocket()) {
      rmSync(path, { force: true })
    }
  } catch {
    // Already gone.
  }
}

/** Removes the records (and their sockets) of brokers whose process has gone. Never throws. */
export function sweepChatSurviveRecords(recordDir: string): void {
  try {
    if (!existsSync(recordDir)) {
      return
    }
    // Tokens live here; a folder made before the mode was set gets it now.
    chmodSync(recordDir, 0o700)
    for (const name of readdirSync(recordDir)) {
      const path = join(recordDir, name)
      if (name.endsWith('.json.next')) {
        // A write that never got renamed; no app instance is writing records this early.
        rmSync(path, { force: true })
      } else if (name.endsWith('.json')) {
        const record = readRecord(path)
        if (record.brokerPid === null || !alive(record.brokerPid)) {
          rmSync(path, { force: true })
          removeSocket(record.socketPath)
        }
      }
    }
  } catch {
    // A sweep that fails leaves things as they were; adoption checks every record anyway.
  }
}
