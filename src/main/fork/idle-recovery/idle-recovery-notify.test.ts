import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readIdleRecoverySettings } from '../../../shared/fork/idle-recovery-settings'
import type { ForkIdleRecoveryInboxItem } from '../../../shared/fork/idle-recovery-wire'
import { notifyIdleRecoveryWaiting } from './idle-recovery-notify'

function item(n: number): ForkIdleRecoveryInboxItem {
  return {
    chatId: `chat-${n}`,
    kind: 'chat',
    agent: 'claude',
    title: `Title ${n}`,
    workspace: 'w',
    worktreeId: null,
    verdict: 'waiting_user',
    question: `Question ${n}?`,
    reason: 'r',
    since: 1,
    wakes: 0,
    wakeAt: null,
    paused: false
  }
}

let dir: string
let server: Server | null = null
let bodies: string[] = []
let status = 200
let hang = false

async function startServer(): Promise<string> {
  bodies = []
  server = createServer((req, res) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      bodies.push(`${req.method} ${req.headers['content-type']} ${data}`)
      if (hang) {
        return
      }
      res.statusCode = status
      res.end('x')
    })
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'idle-notify-'))
  status = 200
  hang = false
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(async () => {
  vi.restoreAllMocks()
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((r) => server!.close(() => r()))
    server = null
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('notifyIdleRecoveryWaiting', () => {
  it('does nothing with every channel off', async () => {
    const notifier = vi.fn()
    await notifyIdleRecoveryWaiting([item(1)], readIdleRecoverySettings({}), {
      desktopNotifier: notifier
    })
    expect(notifier).not.toHaveBeenCalled()
  })

  it('makes one desktop notification for several chats', async () => {
    const notifier = vi.fn()
    await notifyIdleRecoveryWaiting(
      [item(1), item(2), item(3), item(4)],
      readIdleRecoverySettings({ forkInboxNotifyDesktop: true }),
      { desktopNotifier: notifier }
    )
    expect(notifier).toHaveBeenCalledTimes(1)
    expect(notifier.mock.calls[0][0]).toContain('4 chats')
    expect(notifier.mock.calls[0][1]).toContain('and 1 more')
  })

  it('posts the JSON body to the webhook', async () => {
    const url = await startServer()
    await notifyIdleRecoveryWaiting(
      [item(1), item(2)],
      readIdleRecoverySettings({ forkInboxNotifyWebhookUrl: url })
    )
    expect(bodies).toHaveLength(1)
    const [head, ...rest] = bodies[0].split(' ')
    expect(head).toBe('POST')
    const body = JSON.parse(rest.slice(1).join(' '))
    expect(body.count).toBe(2)
    expect(body.items[0]).toEqual({
      id: 'chat-1',
      title: 'Title 1',
      kind: 'chat',
      question: 'Question 1?'
    })
  })

  it('survives a failing and a hanging webhook, logging no address', async () => {
    const url = await startServer()
    status = 500
    const notifier = vi.fn()
    await notifyIdleRecoveryWaiting(
      [item(1)],
      readIdleRecoverySettings({ forkInboxNotifyWebhookUrl: url, forkInboxNotifyDesktop: true }),
      { desktopNotifier: notifier }
    )
    expect(notifier).toHaveBeenCalledTimes(1)
    hang = true
    await notifyIdleRecoveryWaiting(
      [item(1)],
      readIdleRecoverySettings({
        forkInboxNotifyWebhookUrl: url
      }),
      { webhookTimeoutMs: 150 }
    )
    const logged = (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ')
    expect(logged).toContain('webhook: failed')
    expect(logged).toContain('webhook: timeout')
    expect(logged).not.toContain('127.0.0.1')
  })

  it('does not throw when the desktop notifier throws, and other channels still run', async () => {
    const out = join(dir, 'out.json')
    const script = join(dir, 'ok.js')
    writeFileSync(
      script,
      `let d='';process.stdin.on('data',c=>d+=c).on('end',()=>require('fs').writeFileSync(${JSON.stringify(out)},d))`
    )
    await notifyIdleRecoveryWaiting(
      [item(1)],
      readIdleRecoverySettings({
        forkInboxNotifyDesktop: true,
        forkInboxNotifyCommand: `"${process.execPath}" "${script}"`
      }),
      {
        desktopNotifier: () => {
          throw new Error('boom')
        }
      }
    )
    expect(JSON.parse(readFileSync(out, 'utf8')).count).toBe(1)
  })

  it('reports a failing command and kills a slow one', async () => {
    const fail = join(dir, 'fail.js')
    const slow = join(dir, 'slow.js')
    writeFileSync(fail, 'console.log("secret output");process.exit(3)')
    writeFileSync(slow, 'setTimeout(()=>{},60000)')
    await notifyIdleRecoveryWaiting(
      [item(1)],
      readIdleRecoverySettings({ forkInboxNotifyCommand: `"${process.execPath}" "${fail}"` })
    )
    const started = Date.now()
    await notifyIdleRecoveryWaiting(
      [item(1)],
      readIdleRecoverySettings({ forkInboxNotifyCommand: `"${process.execPath}" "${slow}"` }),
      { commandTimeoutMs: 300 }
    )
    expect(Date.now() - started).toBeLessThan(5000)
    const logged = (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ')
    expect(logged).toContain('command: failed')
    expect(logged).toContain('command: timeout')
    expect(logged).not.toContain('secret')
  })
})
