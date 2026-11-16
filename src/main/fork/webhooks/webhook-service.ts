// SLRM-2271 (FORK.md "Webhook automations"): keeps the listener in step with settings, starts the
// run a delivery asks for, and answers `orca webhooks` and the Settings card.
import { isIP } from 'node:net'
import type { Server } from 'node:http'
import {
  resolveForkWebhookSettings,
  type ForkWebhookAddParams,
  type ForkWebhookListResult,
  type ForkWebhookRemoveResult,
  type ForkWebhookSecretResult,
  type ForkWebhookSettings,
  type ResolvedForkWebhookSettings
} from '../../../shared/fork/webhooks'
import type { AutomationOwnerPrecondition } from '../../../shared/automations/ownership/automation-owner-precondition'
import { WebhookStore, type StoredWebhook } from './webhook-store'
import { startWebhookListener } from './webhook-listener'
import {
  dropWebhookPayload,
  formatWebhookPayloadBlock,
  queueWebhookPayload
} from './webhook-payload'

const SETTINGS_POLL_MS = 5_000

export type WebhookRuntime = {
  requireStore(): {
    getSettings(): unknown
    listAutomations?(): readonly { id: string; name: string }[]
  }
  runAutomationNow(id: string, expectedOwner?: AutomationOwnerPrecondition): Promise<{ id: string }>
  automationOwnerPrecondition(id: string): AutomationOwnerPrecondition | null
}

type WebhookHost = {
  store: WebhookStore
  runtime: WebhookRuntime
  server: Server | null
  listeningKey: string | null
  error: string | null
  lastDelivery: Map<string, { at: number; result: string }>
  timer: ReturnType<typeof setInterval> | null
  applying: Promise<void>
}

let active: WebhookHost | null = null

function readSettings(runtime: WebhookRuntime): ResolvedForkWebhookSettings | null {
  try {
    const settings = runtime.requireStore().getSettings() as { forkWebhooks?: ForkWebhookSettings }
    return resolveForkWebhookSettings(settings.forkWebhooks)
  } catch {
    return null
  }
}

function urlHost(bindHost: string): string {
  const shown = bindHost === '0.0.0.0' || bindHost === '::' ? '<this-host-address>' : bindHost
  return isIP(shown) === 6 ? `[${shown}]` : shown
}

function hookUrl(settings: ResolvedForkWebhookSettings, id: string): string {
  return `http://${urlHost(settings.bindHost)}:${settings.port}/hooks/${id}`
}

async function stopListener(host: WebhookHost): Promise<void> {
  const server = host.server
  host.server = null
  host.listeningKey = null
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function startRun(
  host: WebhookHost,
  hook: StoredWebhook,
  event: string | undefined,
  body: string
): Promise<string> {
  const settings = readSettings(host.runtime) ?? resolveForkWebhookSettings(undefined)
  const block = formatWebhookPayloadBlock({
    hookName: hook.name,
    event,
    body,
    maxChars: settings.payloadMaxChars
  })
  queueWebhookPayload(hook.automationId, block, Date.now())
  try {
    const owner = host.runtime.automationOwnerPrecondition(hook.automationId) ?? undefined
    const run = await host.runtime.runAutomationNow(hook.automationId, owner)
    return run.id
  } catch (error) {
    dropWebhookPayload(hook.automationId, block)
    throw error
  }
}

async function apply(host: WebhookHost): Promise<void> {
  const settings = readSettings(host.runtime)
  const wanted = settings?.enabled ? `${settings.bindHost}:${settings.port}` : null
  if (wanted === host.listeningKey && (wanted === null || host.server)) {
    return
  }
  await stopListener(host)
  if (!settings || !wanted) {
    host.error = null
    return
  }
  if (isIP(settings.bindHost) === 0) {
    host.error = `The bind address "${settings.bindHost}" is not an IP address.`
    host.listeningKey = wanted
    return
  }
  try {
    host.server = await startWebhookListener(settings, {
      settings: () => readSettings(host.runtime) ?? settings,
      hook: (id) => host.store.get(id),
      startRun: (hook, event, body) => startRun(host, hook, event, body),
      recordDelivery: (hookId, result) => host.lastDelivery.set(hookId, { at: Date.now(), result })
    })
    host.error = null
  } catch (error) {
    host.error = `Could not listen on ${wanted}: ${error instanceof Error ? error.message : String(error)}`
    console.error('[webhooks]', host.error)
  }
  host.listeningKey = wanted
}

function schedule(host: WebhookHost): Promise<void> {
  host.applying = host.applying
    .then(() => apply(host))
    .catch((error: unknown) => {
      console.error('[webhooks] Could not apply settings:', error)
    })
  return host.applying
}

/** One hook in the RPC server's constructor; the newest server's runtime owns the listener. */
export function attachForkWebhooks(options: {
  userDataPath: string
  runtime: WebhookRuntime
}): void {
  if (active?.timer) {
    clearInterval(active.timer)
  }
  if (active) {
    void stopListener(active)
  }
  const host: WebhookHost = {
    store: new WebhookStore(options.userDataPath),
    runtime: options.runtime,
    server: null,
    listeningKey: null,
    error: null,
    lastDelivery: new Map(),
    timer: null,
    applying: Promise.resolve()
  }
  host.timer = setInterval(() => void schedule(host), SETTINGS_POLL_MS)
  host.timer.unref?.()
  active = host
  void schedule(host)
}

function requireHost(): WebhookHost {
  if (!active) {
    throw new Error('Webhooks are not available on this host.')
  }
  return active
}

function automationName(host: WebhookHost, automationId: string): string | null {
  try {
    return (
      host.runtime
        .requireStore()
        .listAutomations?.()
        ?.find((entry) => entry.id === automationId)?.name ?? null
    )
  } catch {
    return null
  }
}

export async function listForkWebhooks(): Promise<ForkWebhookListResult> {
  const host = requireHost()
  await schedule(host)
  const settings = readSettings(host.runtime) ?? resolveForkWebhookSettings(undefined)
  return {
    enabled: settings.enabled,
    listening: host.server ? `${settings.bindHost}:${settings.port}` : null,
    error: host.error,
    hooks: host.store.list().map((hook) => ({
      id: hook.id,
      name: hook.name,
      automationId: hook.automationId,
      automationName: automationName(host, hook.automationId),
      events: hook.events,
      when: hook.when,
      url: hookUrl(settings, hook.id),
      createdAt: hook.createdAt,
      lastDelivery: host.lastDelivery.get(hook.id) ?? null
    }))
  }
}

function secretResult(host: WebhookHost, hook: StoredWebhook): ForkWebhookSecretResult {
  const settings = readSettings(host.runtime) ?? resolveForkWebhookSettings(undefined)
  return { id: hook.id, name: hook.name, url: hookUrl(settings, hook.id), secret: hook.secret }
}

export function addForkWebhook(params: ForkWebhookAddParams): ForkWebhookSecretResult {
  const host = requireHost()
  if (automationName(host, params.automationId) === null) {
    throw new Error(
      `No automation has the id "${params.automationId}". Run "orca automations list".`
    )
  }
  const hook = host.store.add({
    name: params.name,
    automationId: params.automationId,
    events: params.events ?? [],
    when: params.when ?? []
  })
  return secretResult(host, hook)
}

export function rotateForkWebhook(target: string): ForkWebhookSecretResult {
  const host = requireHost()
  return secretResult(host, host.store.rotate(target))
}

export function removeForkWebhook(target: string): ForkWebhookRemoveResult {
  const host = requireHost()
  const hook = host.store.remove(target)
  host.lastDelivery.delete(hook.id)
  return { id: hook.id, name: hook.name }
}
