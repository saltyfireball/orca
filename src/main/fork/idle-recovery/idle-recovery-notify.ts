// Idle recovery (FORK.md), item F: tells the user a chat started waiting on them.
// Contract: called once per sweep with the chats that newly wait. Each target is its own
// setting and off by default: a desktop notification (`notifyDesktop`), a POST of the items as
// JSON (`notifyWebhookUrl`), and a command given the same JSON on stdin (`notifyCommand`). A
// failing target is logged without its address or output and never stops the others or the
// sweep. Never throws.
import { spawn } from 'node:child_process'
import type { IdleRecoverySettings } from '../../../shared/fork/idle-recovery-settings'
import type { ForkIdleRecoveryInboxItem } from '../../../shared/fork/idle-recovery-wire'

export const IDLE_RECOVERY_NOTIFY_WEBHOOK_TIMEOUT_MS = 5000
export const IDLE_RECOVERY_NOTIFY_COMMAND_TIMEOUT_MS = 10000
const MAX_BODY_TITLES = 3
const MAX_FIELD_CHARS = 500

export type IdleRecoveryDesktopNotifier = (title: string, body: string) => void | Promise<void>

export type IdleRecoveryNotifyOptions = {
  desktopNotifier?: IdleRecoveryDesktopNotifier
  webhookTimeoutMs?: number
  commandTimeoutMs?: number
  fetchImpl?: typeof fetch
}

type Outcome = 'ok' | 'failed' | 'timeout'

// Why a slot: this file is also bundled into the headless server, which must not import
// Electron. The desktop app hands its notifier in at start-up, elsewhere there is none.
let desktopNotifierSlot: IdleRecoveryDesktopNotifier | null = null

export function setIdleRecoveryDesktopNotifier(notifier: IdleRecoveryDesktopNotifier | null): void {
  desktopNotifierSlot = notifier
}

function clip(value: string): string {
  return value.length > MAX_FIELD_CHARS ? value.slice(0, MAX_FIELD_CHARS) : value
}

export function idleRecoveryNotifyPayload(items: readonly ForkIdleRecoveryInboxItem[]): string {
  return JSON.stringify({
    count: items.length,
    items: items.map((item) => ({
      id: item.chatId,
      title: clip(item.title),
      kind: item.kind,
      question: clip(item.question)
    }))
  })
}

function desktopText(items: readonly ForkIdleRecoveryInboxItem[]): { title: string; body: string } {
  if (items.length === 1) {
    return { title: 'A chat is waiting on you', body: clip(items[0].question || items[0].title) }
  }
  const names = items.slice(0, MAX_BODY_TITLES).map((item) => item.title || item.chatId)
  const more = items.length - names.length
  return {
    title: `${items.length} chats are waiting on you`,
    body: names.join(', ') + (more > 0 ? `, and ${more} more` : '')
  }
}

function report(logTag: string, channel: string, outcome: Outcome): void {
  if (outcome !== 'ok') {
    console.warn(`[${logTag}] notify ${channel}: ${outcome}`)
  }
}

async function sendDesktop(
  text: { title: string; body: string },
  notifier: IdleRecoveryDesktopNotifier
): Promise<Outcome> {
  try {
    await notifier(text.title, text.body)
    return 'ok'
  } catch {
    return 'failed'
  }
}

async function sendWebhook(
  url: string,
  payload: string,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<Outcome> {
  if (!/^https?:\/\//i.test(url)) {
    return 'failed'
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      redirect: 'error',
      signal: controller.signal
    })
    // Drain so the connection frees; the body is never read for content.
    await response.arrayBuffer().catch(() => undefined)
    return response.ok ? 'ok' : 'failed'
  } catch {
    return controller.signal.aborted ? 'timeout' : 'failed'
  } finally {
    clearTimeout(timer)
  }
}

function runCommand(command: string, payload: string, timeoutMs: number): Promise<Outcome> {
  return new Promise<Outcome>((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout | null = null
    const finish = (outcome: Outcome): void => {
      if (!settled) {
        settled = true
        if (timer) {
          clearTimeout(timer)
        }
        resolve(outcome)
      }
    }
    try {
      const child = spawn(command, { shell: true, stdio: ['pipe', 'ignore', 'ignore'] })
      timer = setTimeout(() => {
        // Only this child, by its own pid.
        try {
          if (child.pid !== undefined) {
            process.kill(child.pid, 'SIGKILL')
          }
        } catch {
          // already gone
        }
        finish('timeout')
      }, timeoutMs)
      child.on('error', () => finish('failed'))
      child.on('close', (code) => finish(code === 0 ? 'ok' : 'failed'))
      child.stdin.on('error', () => undefined)
      child.stdin.end(payload)
    } catch {
      finish('failed')
    }
  })
}

async function guarded(
  logTag: string,
  channel: string,
  run: () => Promise<Outcome>
): Promise<void> {
  let outcome: Outcome
  try {
    outcome = await run()
  } catch {
    outcome = 'failed'
  }
  report(logTag, channel, outcome)
}

/** One message for the notify targets; a null target is skipped. */
export type ForkNotifyMessage = {
  /** Tags the log line of a failing target, never with its address or output. */
  logTag: string
  desktop: { title: string; body: string } | null
  webhookUrl: string | null
  command: string | null
  /** The JSON the webhook gets as its body and the command on stdin. */
  payload: () => string
}

/**
 * The notify targets of SLRM-2208, shared with server health alerts (SLRM-2311): each target
 * that is set is told once, in parallel; a failing target is logged and stops nothing. Never
 * throws.
 */
export async function sendForkNotifyTargets(
  message: ForkNotifyMessage,
  options: IdleRecoveryNotifyOptions = {}
): Promise<void> {
  try {
    const jobs: Promise<void>[] = []
    const { logTag, desktop, webhookUrl, command } = message
    const desktopNotifier = options.desktopNotifier ?? desktopNotifierSlot
    if (desktop && desktopNotifier) {
      jobs.push(guarded(logTag, 'desktop', () => sendDesktop(desktop, desktopNotifier)))
    }
    const payload = webhookUrl || command ? message.payload() : ''
    if (webhookUrl) {
      jobs.push(
        guarded(logTag, 'webhook', () =>
          sendWebhook(
            webhookUrl,
            payload,
            options.webhookTimeoutMs ?? IDLE_RECOVERY_NOTIFY_WEBHOOK_TIMEOUT_MS,
            options.fetchImpl ?? fetch
          )
        )
      )
    }
    if (command) {
      jobs.push(
        guarded(logTag, 'command', () =>
          runCommand(
            command,
            payload,
            options.commandTimeoutMs ?? IDLE_RECOVERY_NOTIFY_COMMAND_TIMEOUT_MS
          )
        )
      )
    }
    await Promise.all(jobs)
  } catch {
    // Never throws into the caller.
  }
}

export async function notifyIdleRecoveryWaiting(
  items: readonly ForkIdleRecoveryInboxItem[],
  settings: IdleRecoverySettings,
  options: IdleRecoveryNotifyOptions = {}
): Promise<void> {
  if (items.length === 0) {
    return
  }
  await sendForkNotifyTargets(
    {
      logTag: 'idle-recovery',
      desktop: settings.notifyDesktop ? desktopText(items) : null,
      webhookUrl: settings.notifyWebhookUrl,
      command: settings.notifyCommand,
      payload: () => idleRecoveryNotifyPayload(items)
    },
    options
  )
}
