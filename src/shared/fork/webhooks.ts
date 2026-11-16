// SLRM-2271 (FORK.md "Webhook automations"): an outside service (a CI failure, a repo event)
// starts an automation run by POSTing a signed request. Off by default.
import { z } from 'zod'

export type ForkWebhookSettings = {
  /** Listen for webhooks. Off unless true. */
  enabled?: boolean
  /** IP address the listener binds; unset is 127.0.0.1 (this machine only). */
  bindHost?: string
  /** TCP port of the listener; unset is 47390. */
  port?: number
  /** Largest request body accepted, in KB; unset is 256. */
  maxBodyKb?: number
  /** Deliveries one webhook accepts per minute; unset is 30. */
  perHookPerMinute?: number
  /** Characters of the payload added to the automation's prompt; unset is 20000. */
  payloadMaxChars?: number
}

export const FORK_WEBHOOK_DEFAULTS = {
  enabled: false,
  bindHost: '127.0.0.1',
  port: 47390,
  maxBodyKb: 256,
  perHookPerMinute: 30,
  payloadMaxChars: 20_000
} as const

export type ResolvedForkWebhookSettings = {
  enabled: boolean
  bindHost: string
  port: number
  maxBodyKb: number
  perHookPerMinute: number
  payloadMaxChars: number
}

function whole(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback
}

export function resolveForkWebhookSettings(
  raw: ForkWebhookSettings | null | undefined
): ResolvedForkWebhookSettings {
  const d = FORK_WEBHOOK_DEFAULTS
  return {
    enabled: raw?.enabled === true,
    bindHost:
      typeof raw?.bindHost === 'string' && raw.bindHost.trim() ? raw.bindHost.trim() : d.bindHost,
    port: whole(raw?.port, 1024, 65_535, d.port),
    maxBodyKb: whole(raw?.maxBodyKb, 1, 4096, d.maxBodyKb),
    perHookPerMinute: whole(raw?.perHookPerMinute, 1, 600, d.perHookPerMinute),
    payloadMaxChars: whole(raw?.payloadMaxChars, 1000, 200_000, d.payloadMaxChars)
  }
}

export type ForkWebhookCondition = { path: string; value: string }

export type ForkWebhookRow = {
  id: string
  name: string
  automationId: string
  automationName: string | null
  events: string[]
  when: ForkWebhookCondition[]
  /** Where to POST, from the bind address and port in settings. */
  url: string
  createdAt: number
  lastDelivery: { at: number; result: string } | null
}

export type ForkWebhookListResult = {
  enabled: boolean
  /** The address the listener is on, or null when it is not listening. */
  listening: string | null
  /** Why it is not listening when it should be. */
  error: string | null
  hooks: ForkWebhookRow[]
}

/** The only reply that carries the signing secret: add and rotate. */
export type ForkWebhookSecretResult = { id: string; name: string; url: string; secret: string }

export type ForkWebhookRemoveResult = { id: string; name: string }

const Condition = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/),
  value: z.string().max(200)
})

export const ForkWebhookAddParams = z.object({
  name: z.string().trim().min(1).max(80),
  automationId: z.string().trim().min(1).max(200),
  events: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  when: z.array(Condition).max(10).optional()
})
export type ForkWebhookAddParams = z.infer<typeof ForkWebhookAddParams>

/** A webhook id, a unique prefix of it, or its name. */
export const ForkWebhookTargetParams = z.object({ target: z.string().trim().min(1).max(200) })
export type ForkWebhookTargetParams = z.infer<typeof ForkWebhookTargetParams>

export const ForkWebhookListParams = z.object({})

/** `path=value` as typed on the CLI. */
export function parseForkWebhookCondition(text: string): ForkWebhookCondition | null {
  const at = text.indexOf('=')
  if (at <= 0) {
    return null
  }
  const parsed = Condition.safeParse({ path: text.slice(0, at), value: text.slice(at + 1) })
  return parsed.success ? parsed.data : null
}
