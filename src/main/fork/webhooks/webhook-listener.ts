// SLRM-2271 (FORK.md "Webhook automations"): the HTTP listener. Only POST /hooks/<id> with a valid
// signature over the body starts anything; every other request is refused before any work.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { ResolvedForkWebhookSettings } from '../../../shared/fork/webhooks'
import { WEBHOOK_ID_PATTERN, type StoredWebhook } from './webhook-store'
import {
  conditionsHold,
  DeliveryIdMemory,
  eventAccepted,
  SIGNATURE_HEADERS,
  signatureMatches,
  WindowLimiter
} from './webhook-checks'

const FAILED_AUTH_WINDOW_MS = 10 * 60_000
const FAILED_AUTH_LIMIT = 20
const MAX_IN_FLIGHT = 16
const MAX_IN_FLIGHT_PER_SOURCE = 4
const EVENT_HEADERS = ['x-github-event', 'x-gitlab-event', 'x-blackfish-event'] as const
const DELIVERY_HEADERS = ['x-github-delivery', 'x-blackfish-delivery'] as const

export type WebhookListenerDeps = {
  settings: () => ResolvedForkWebhookSettings
  hook: (id: string) => StoredWebhook | undefined
  /** Starts the run; resolves to its id. */
  startRun: (hook: StoredWebhook, event: string | undefined, body: string) => Promise<string>
  recordDelivery: (hookId: string, result: string) => void
}

function header(request: IncomingMessage, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = request.headers[name]
    if (typeof value === 'string' && value.length > 0) {
      return value.slice(0, 200)
    }
  }
  return undefined
}

function send(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  if (response.headersSent) {
    return
  }
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    connection: 'close'
  })
  response.end(JSON.stringify(body))
}

function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer | 'too-large'> {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers['content-length'])
    if (Number.isFinite(declared) && declared > maxBytes) {
      resolve('too-large')
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        request.removeAllListeners('data')
        request.resume()
        resolve('too-large')
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

export function createWebhookRequestHandler(
  deps: WebhookListenerDeps
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const failedAuth = new WindowLimiter(FAILED_AUTH_WINDOW_MS)
  const perHook = new WindowLimiter(60_000, 500)
  const deliveries = new DeliveryIdMemory()
  // Why: unknown ids are checked against a throwaway secret so they cost the same as known ones.
  const decoySecret = randomBytes(32).toString('hex')
  let inFlight = 0
  const inFlightBySource = new Map<string, number>()

  return async (request, response) => {
    const now = Date.now()
    const source = request.socket.remoteAddress ?? 'unknown'
    const match = /^\/hooks\/([^/?#]+)$/.exec((request.url ?? '').split('?')[0])
    if (!match) {
      send(response, 404, { error: 'not found' })
      return
    }
    if (request.method !== 'POST') {
      send(response, 405, { error: 'POST only' })
      return
    }
    // Why: behind a proxy every sender shares one address, so a locked-out source still gets
    // its signed deliveries through; only its unsigned ones are refused with 429.
    const lockedOut = failedAuth.count(source, now) >= FAILED_AUTH_LIMIT
    const fromSource = inFlightBySource.get(source) ?? 0
    if (inFlight >= MAX_IN_FLIGHT || fromSource >= MAX_IN_FLIGHT_PER_SOURCE) {
      send(response, 503, { error: 'busy' })
      return
    }
    inFlight += 1
    inFlightBySource.set(source, fromSource + 1)
    try {
      const settings = deps.settings()
      const body = await readBody(request, settings.maxBodyKb * 1024)
      if (body === 'too-large') {
        send(response, 413, { error: 'body too large' })
        return
      }
      const id = match[1]
      const hook = WEBHOOK_ID_PATTERN.test(id) ? deps.hook(id) : undefined
      const signature = header(request, SIGNATURE_HEADERS)
      const signed = signatureMatches(hook?.secret ?? decoySecret, body, signature)
      if (!hook || !signed) {
        failedAuth.record(source, now)
        send(
          response,
          lockedOut ? 429 : 401,
          lockedOut ? { error: 'too many failed attempts' } : { error: 'invalid signature' }
        )
        return
      }
      if (perHook.count(hook.id, now) >= settings.perHookPerMinute) {
        deps.recordDelivery(hook.id, 'rate limited')
        send(response, 429, { error: 'rate limited' })
        return
      }
      perHook.record(hook.id, now)
      const event = header(request, EVENT_HEADERS)
      const delivery = header(request, DELIVERY_HEADERS)
      // The delivery and event headers are not signed: a replay is bounded by the rate limit.
      const deliveryKey = delivery ? `${hook.id}:${delivery}` : undefined
      if (deliveryKey && !deliveries.remember(deliveryKey)) {
        send(response, 200, { ok: true, duplicate: true })
        return
      }
      if (event === 'ping') {
        deps.recordDelivery(hook.id, 'ping')
        send(response, 200, { ok: true })
        return
      }
      const text = body.toString('utf8')
      let payload: unknown = null
      try {
        payload = JSON.parse(text)
      } catch {
        // Not JSON: conditions cannot hold, but a hook without them still runs on the text.
      }
      if (!eventAccepted(hook.events, event) || !conditionsHold(payload, hook.when)) {
        deps.recordDelivery(hook.id, `ignored (${event ?? 'no event'})`)
        send(response, 202, { ok: true, ignored: true })
        return
      }
      try {
        const runId = await deps.startRun(hook, event, text)
        deps.recordDelivery(hook.id, `started run ${runId}`)
        send(response, 202, { ok: true, runId })
      } catch (error) {
        console.error('[webhooks] Could not start the automation run:', error)
        if (deliveryKey) {
          deliveries.forget(deliveryKey)
        }
        deps.recordDelivery(hook.id, 'automation could not start')
        send(response, 500, { error: 'automation could not start' })
      }
    } catch {
      send(response, 400, { error: 'bad request' })
    } finally {
      inFlight -= 1
      const left = (inFlightBySource.get(source) ?? 1) - 1
      if (left > 0) {
        inFlightBySource.set(source, left)
      } else {
        inFlightBySource.delete(source)
      }
    }
  }
}

export function startWebhookListener(
  settings: ResolvedForkWebhookSettings,
  deps: WebhookListenerDeps
): Promise<Server> {
  const handle = createWebhookRequestHandler(deps)
  const server = createServer((request, response) => {
    void handle(request, response)
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 1_000
  server.maxHeadersCount = 64
  server.maxRequestsPerSocket = 1
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(settings.port, settings.bindHost, () => {
      server.off('error', reject)
      server.on('error', (error) => console.error('[webhooks] Listener error:', error))
      // The listener never keeps a host process alive by itself.
      server.unref()
      resolve(server)
    })
  })
}
