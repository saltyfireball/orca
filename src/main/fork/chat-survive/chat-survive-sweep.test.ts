import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeChatSurviveRecord, type ChatSurviveRecord } from './chat-survive-registry'
import { installChatSurviveSettingReader } from './chat-survive-setting'
import { chatSurviveConfig, setChatSurviveConfigReader } from './chat-survive-spawn'
import { sweepChatSurviveRecords } from './chat-survive-sweep'

const entryPath = vi.hoisted(() => vi.fn(() => '/entry.js'))
vi.mock('../../worker-threads/forked-child-entry-path', () => ({
  getForkedChildEntryPath: entryPath
}))

const dirs: string[] = []
const servers: Server[] = []

afterEach(async () => {
  setChatSurviveConfigReader(null)
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))))
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  // Short: a Unix socket path is capped near 104 bytes on macOS.
  const dir = mkdtempSync(join(tmpdir(), 'csw-'))
  dirs.push(dir)
  return dir
}

/** A socket file, as a SIGKILLed broker leaves one; the listener stays up so the file does. */
async function staleSocket(path: string): Promise<void> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(path, resolve))
  servers.push(server)
}

/** A pid that was just in use and is now free. */
function deadPid(): number {
  let pid = 99_999
  for (; pid > 1; pid -= 1) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
        return pid
      }
    }
  }
  throw new Error('no free pid')
}

describe.runIf(process.platform !== 'win32')('chat-survive startup sweep', () => {
  it('removes the records and sockets of brokers that are gone and keeps the rest', async () => {
    const base = tempDir()
    const recordDir = join(base, 'chat-survive')
    const socketDir = join(base, 'orca-chat-survive')
    mkdirSync(recordDir, { mode: 0o755 })
    chmodSync(recordDir, 0o755)
    mkdirSync(socketDir)
    const deadSocket = join(socketDir, 'dead.sock')
    await staleSocket(deadSocket)
    const record = (pid: number, socketPath: string): ChatSurviveRecord => ({
      v: 1,
      sessionId: 's',
      brokerPid: pid,
      socketPath,
      token: 't'
    })
    writeChatSurviveRecord(join(recordDir, 's.dead.json'), record(deadPid(), deadSocket))
    writeChatSurviveRecord(
      join(recordDir, 's.live.json'),
      record(process.pid, join(socketDir, 'x'))
    )
    // A record never touches a socket outside a broker socket folder.
    const elsewhere = join(base, 'other.sock')
    await staleSocket(elsewhere)
    writeChatSurviveRecord(join(recordDir, 's.away.json'), record(deadPid(), elsewhere))

    sweepChatSurviveRecords(recordDir)
    expect(readdirSync(recordDir).sort()).toEqual(['s.live.json'])
    expect(existsSync(deadSocket)).toBe(false)
    expect(existsSync(elsewhere)).toBe(true)
    expect(statSync(recordDir).mode & 0o777).toBe(0o700)
    sweepChatSurviveRecords(join(base, 'missing'))
  })

  it('reads nothing more than the setting while it is off', () => {
    let on = false
    installChatSurviveSettingReader(() => on, tempDir())
    expect(chatSurviveConfig()).toBeNull()
    expect(entryPath).not.toHaveBeenCalled()
    on = true
    expect(chatSurviveConfig()).toMatchObject({ enabled: true, entryPath: '/entry.js' })
  })
})
