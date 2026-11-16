// SLRM-2271 (FORK.md "Webhook automations"): the checks a delivery passes before it can start a
// run: an HMAC-SHA256 signature over the raw body, rate limits and the hook's own filters.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ForkWebhookCondition } from '../../../shared/fork/webhooks'

/** GitHub's header first, then Blackfish's own for senders that let you name the header. */
export const SIGNATURE_HEADERS = ['x-hub-signature-256', 'x-blackfish-signature-256'] as const

const SIGNATURE_PATTERN = /^sha256=([a-f0-9]{64})$/i

/** Constant-time check of `sha256=<hex>` against the body's HMAC under the secret. */
export function signatureMatches(
  secret: string,
  body: Buffer,
  header: string | undefined
): boolean {
  const expected = createHmac('sha256', secret).update(body).digest()
  const given = header ? SIGNATURE_PATTERN.exec(header.trim()) : null
  // Why: compare even when the header is malformed, so its shape does not show in the timing.
  const presented = given ? Buffer.from(given[1], 'hex') : Buffer.alloc(expected.length)
  return timingSafeEqual(expected, presented) && given !== null
}

/** Sliding one-window counter per key, with a bound on how many keys it remembers. */
export class WindowLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly windowMs: number,
    private readonly maxKeys = 2000
  ) {}

  count(key: string, now: number): number {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs)
    if (recent.length === 0) {
      this.hits.delete(key)
    } else {
      this.hits.set(key, recent)
    }
    return recent.length
  }

  record(key: string, now: number): void {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs)
    recent.push(now)
    this.hits.delete(key)
    this.hits.set(key, recent)
    if (this.hits.size > this.maxKeys) {
      // Maps keep insertion order, and a recorded key moves to the end, so the first is the stalest.
      const stalest = this.hits.keys().next().value
      if (stalest !== undefined) {
        this.hits.delete(stalest)
      }
    }
  }
}

/** Remembers recent delivery ids so a sender's retry of a delivered event starts no second run. */
export class DeliveryIdMemory {
  private readonly seen = new Set<string>()

  constructor(private readonly limit = 500) {}

  /** Lets a sender's retry through again after the delivery failed to start a run. */
  forget(id: string): void {
    this.seen.delete(id)
  }

  /** True the first time an id is seen. */
  remember(id: string): boolean {
    if (this.seen.has(id)) {
      return false
    }
    this.seen.add(id)
    if (this.seen.size > this.limit) {
      const oldest = this.seen.values().next().value
      if (oldest !== undefined) {
        this.seen.delete(oldest)
      }
    }
    return true
  }
}

function valueAt(payload: unknown, path: string): unknown {
  let current = payload
  for (const key of path.split('.')) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** Every condition must hold; a value compares as text, so `workflow_run.conclusion=failure`. */
export function conditionsHold(payload: unknown, when: readonly ForkWebhookCondition[]): boolean {
  return when.every((condition) => {
    const value = valueAt(payload, condition.path)
    return (
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') &&
      String(value) === condition.value
    )
  })
}

/** An empty list takes every event; otherwise the sender's event header must be in it. */
export function eventAccepted(events: readonly string[], event: string | undefined): boolean {
  return events.length === 0 || (event !== undefined && events.includes(event))
}
