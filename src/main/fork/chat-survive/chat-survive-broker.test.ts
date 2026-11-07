import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatSurviveByteRing } from './chat-survive-byte-ring'
import { startChatSurviveBroker, type ChatSurviveBroker } from './chat-survive-broker'
import {
  ChatSurviveRefusedError,
  connectChatSurviveBroker,
  type ChatSurviveConnection
} from './chat-survive-client'
import { CHAT_SURVIVE_PROTOCOL_VERSION } from './chat-survive-protocol'

const TOKEN = 'test-token-0123456789abcdef'

// Echoes each stdin line; `later` answers after a delay, so the reply lands while no owner listens.
const PROVIDER = `
const rl = require('node:readline').createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (line === 'later') setTimeout(() => process.stdout.write('late\\n'), 150)
  else if (line === 'quit') process.exit(3)
  else process.stdout.write('echo:' + line + '\\n')
})
process.stderr.write('ready\\n')
`

// An app instance reduced to its socket: it attaches, says so, and then just stays.
const OWNER = `
const socket = require('node:net').createConnection(process.argv[1], () => {
  socket.write(JSON.stringify({ t: 'hello', v: ${CHAT_SURVIVE_PROTOCOL_VERSION}, token: process.argv[2],
    fence: 1, from: { out: 0, err: 0 } }) + '\\n')
})
socket.on('data', (chunk) => { if (String(chunk).includes('"welcome"')) process.stdout.write('attached\\n') })
setInterval(() => {}, 1000)
`

const dirs: string[] = []
const brokers: ChatSurviveBroker[] = []
const owners: ChildProcess[] = []

afterEach(async () => {
  for (const owner of owners.splice(0)) {
    owner.kill('SIGKILL')
  }
  await Promise.all(brokers.splice(0).map((broker) => broker.close()))
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function socketPath(): string {
  // Unix socket paths are capped near 104 bytes on macOS; tmpdir keeps it short.
  const dir = mkdtempSync(join(tmpdir(), 'cs-'))
  dirs.push(dir)
  return join(dir, 'b.sock')
}

async function broker(orphanTimeoutMs = 10_000, outRingBytes?: number) {
  const path = socketPath()
  const started = await startChatSurviveBroker({
    command: process.execPath,
    args: ['-e', PROVIDER],
    socketPath: path,
    token: TOKEN,
    orphanTimeoutMs,
    stopGraceMs: 500,
    ...(outRingBytes ? { outRingBytes } : {})
  })
  brokers.push(started)
  return { path, broker: started }
}

function collect(connection: ChatSurviveConnection): () => string {
  let text = ''
  connection.stdout.on('data', (chunk: Buffer) => {
    text += chunk.toString('utf8')
  })
  return () => text
}

// The provider and the owner are real processes, so their output arrives on their schedule.
async function waitFor(check: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(check()).toBe(true), { timeout: 3_000, interval: 20 })
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('chat-survive byte ring', () => {
  it('keeps the newest bytes and says when a requested offset was lost', () => {
    const ring = new ChatSurviveByteRing(8)
    ring.append(Buffer.from('abcdef'))
    ring.append(Buffer.from('ghij'))
    expect(ring.first).toBe(2)
    expect(ring.end).toBe(10)
    expect(ring.sliceFrom(4)).toMatchObject({ first: 4, truncated: false })
    expect(ring.sliceFrom(4).data.toString()).toBe('efghij')
    const lost = ring.sliceFrom(0)
    expect(lost).toMatchObject({ first: 2, end: 10, truncated: true })
    expect(lost.data.toString()).toBe('cdefghij')
    expect(ring.sliceFrom(10).data.length).toBe(0)
    ring.append(Buffer.from('0123456789XY'))
    expect(ring.sliceFrom(0).data.toString()).toBe('456789XY')
  })
})

describe('chat-survive broker', () => {
  it('reattaches a new owner and replays what the provider wrote while nobody listened', async () => {
    const { path, broker: host } = await broker()
    const first = await connectChatSurviveBroker({ socketPath: path, token: TOKEN, fence: 1 })
    const firstText = collect(first)
    first.write('hello\n')
    await waitFor(() => firstText().includes('echo:hello\n'))
    first.write('later\n')
    const held = first.offsets()
    first.detach()
    await waitFor(() => !host.status().attached)
    // The reply arrives with no owner attached; the provider must not notice.
    await waitFor(() => host.status().out > held.out)
    expect(alive(host.pid)).toBe(true)

    const second = await connectChatSurviveBroker({
      socketPath: path,
      token: TOKEN,
      fence: 2,
      from: held
    })
    const secondText = collect(second)
    expect(second.welcome).toMatchObject({ pid: host.pid, exit: null })
    expect(second.welcome.out.truncated).toBe(false)
    await waitFor(() => secondText() === 'late\n')
    second.write('again\n')
    await waitFor(() => secondText() === 'late\necho:again\n')
  })

  it('lets a higher fence take over and refuses a stale one or a bad token', async () => {
    const { path } = await broker()
    const first = await connectChatSurviveBroker({ socketPath: path, token: TOKEN, fence: 5 })
    await expect(
      connectChatSurviveBroker({ socketPath: path, token: TOKEN, fence: 4 })
    ).rejects.toMatchObject({ reason: 'stale-fence' })
    await expect(
      connectChatSurviveBroker({ socketPath: path, token: 'wrong', fence: 9 })
    ).rejects.toBeInstanceOf(ChatSurviveRefusedError)
    const second = await connectChatSurviveBroker({ socketPath: path, token: TOKEN, fence: 6 })
    expect(await first.ended).toBe('superseded')
    const text = collect(second)
    second.write('mine\n')
    await waitFor(() => text().includes('echo:mine\n'))
  })

  it('reports a lost prefix when the ring overflowed while detached', async () => {
    const { path, broker: host } = await broker(10_000, 16)
    const first = await connectChatSurviveBroker({ socketPath: path, token: TOKEN, fence: 1 })
    first.write('abcdefghijklmnop\n')
    first.detach()
    // 22 bytes of echo into a 16-byte ring: the first 6 are gone.
    await waitFor(() => host.status().out === 22 && !host.status().attached)
    const next = await connectChatSurviveBroker({ socketPath: path, token: TOKEN, fence: 2 })
    const text = collect(next)
    expect(next.welcome.out).toMatchObject({ truncated: true, first: 6, end: 22 })
    await waitFor(() => text() === 'bcdefghijklmnop\n')
  })

  it('stops the provider group when no owner comes back before the orphan timeout', async () => {
    const { path, broker: host } = await broker(300)
    const first = await connectChatSurviveBroker({ socketPath: path, token: TOKEN, fence: 1 })
    first.detach()
    const end = await host.done
    expect(end.reason).toBe('orphan-timeout')
    expect(end.exit).not.toBeNull()
    expect(alive(host.pid)).toBe(false)
    expect(existsSync(path)).toBe(false)
  })

  it('cancels the orphan timeout when an owner reattaches in time', async () => {
    const { path, broker: host } = await broker()
    expect(host.status().orphaned).toBe(true)
    const first = await connectChatSurviveBroker({ socketPath: path, token: TOKEN, fence: 1 })
    expect(host.status().orphaned).toBe(false)
    first.detach()
    await waitFor(() => host.status().orphaned)
    const second = await connectChatSurviveBroker({ socketPath: path, token: TOKEN, fence: 2 })
    expect(host.status()).toMatchObject({ attached: true, orphaned: false })
    expect(alive(host.pid)).toBe(true)
    const text = collect(second)
    second.write('still\n')
    await waitFor(() => text().includes('echo:still\n'))
  })

  it('stops the provider when its owner dies without handing it off', async () => {
    const { path, broker: host } = await broker()
    const owner = spawn(process.execPath, ['-e', OWNER, path, TOKEN], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    owners.push(owner)
    let ownerText = ''
    owner.stdout?.on('data', (chunk: Buffer) => {
      ownerText += chunk.toString('utf8')
    })
    await waitFor(() => ownerText.includes('attached') && host.status().attached)
    // SIGKILL: no hand-off, as in a crash. Nobody could resume it, so it stops as today.
    owner.kill('SIGKILL')
    expect((await host.done).reason).toBe('closed')
    expect(alive(host.pid)).toBe(false)
  })

  it('takes a new owner only with a higher fence, and its input at the socket pace', async () => {
    const { path } = await broker()
    const first = await connectChatSurviveBroker({ socketPath: path, token: TOKEN, fence: 2 })
    const done = Promise.withResolvers<void>()
    first.write('paced\n', done.resolve)
    await done.promise
    first.detach()
    await expect(
      connectChatSurviveBroker({ socketPath: path, token: TOKEN, fence: 2 })
    ).rejects.toThrow(ChatSurviveRefusedError)
    const next = await connectChatSurviveBroker({ socketPath: path, token: TOKEN, fence: 3 })
    const text = collect(next)
    await waitFor(() => text().includes('echo:paced\n'))
  })

  it('refuses a broker that welcomes in another protocol version', async () => {
    const path = socketPath()
    const server = createServer((socket) => {
      const ring = { first: 0, end: 0, truncated: false }
      const welcome = { t: 'welcome', pid: 1, fence: 1, out: ring, err: ring, exit: null }
      socket.write(`${JSON.stringify({ ...welcome, v: CHAT_SURVIVE_PROTOCOL_VERSION + 1 })}\n`)
    })
    await new Promise<void>((resolve) => server.listen(path, resolve))
    await expect(
      connectChatSurviveBroker({ socketPath: path, token: TOKEN, fence: 1 })
    ).rejects.toMatchObject({ reason: 'version' })
    await new Promise((resolve) => server.close(resolve))
  })

  it('tells an owner that arrives after the provider exited how it ended', async () => {
    const { path, broker: host } = await broker()
    const first = await connectChatSurviveBroker({ socketPath: path, token: TOKEN, fence: 1 })
    const held = first.offsets()
    first.write('bye\n')
    first.write('quit\n')
    first.detach()
    await waitFor(() => host.status().exit !== null)
    const next = await connectChatSurviveBroker({
      socketPath: path,
      token: TOKEN,
      fence: 2,
      from: held
    })
    const text = collect(next)
    expect(next.welcome.exit).toEqual({ code: 3, signal: null })
    await waitFor(() => text() === 'echo:bye\n')
    expect(await next.exited).toEqual({ code: 3, signal: null })
  })
})
