// SLRM-2271 (FORK.md "Webhook automations"): the webhooks and their signing secrets, kept out of
// settings (so no settings export carries a secret) in fork-webhooks.json, owner-only file mode.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { writeDurableSecureJsonFile } from '../../../shared/secure-storage/secure-file'
import type { ForkWebhookCondition } from '../../../shared/fork/webhooks'

export const WEBHOOKS_FILE = 'fork-webhooks.json'

export type StoredWebhook = {
  id: string
  name: string
  automationId: string
  secret: string
  events: string[]
  when: ForkWebhookCondition[]
  createdAt: number
}

export const WEBHOOK_ID_PATTERN = /^[a-f0-9]{24}$/

function newSecret(): string {
  return `bfwh_${randomBytes(32).toString('hex')}`
}

function valid(entry: unknown): entry is StoredWebhook {
  const hook = entry as Partial<StoredWebhook> | null
  return (
    typeof hook?.id === 'string' &&
    WEBHOOK_ID_PATTERN.test(hook.id) &&
    typeof hook.name === 'string' &&
    typeof hook.automationId === 'string' &&
    typeof hook.secret === 'string' &&
    hook.secret.length >= 32 &&
    Array.isArray(hook.events) &&
    Array.isArray(hook.when)
  )
}

export class WebhookStore {
  private readonly path: string
  private hooks: StoredWebhook[] = []

  constructor(userDataPath: string) {
    this.path = join(userDataPath, WEBHOOKS_FILE)
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as { hooks?: unknown[] }
      this.hooks = (raw.hooks ?? []).filter(valid)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[webhooks] Could not read the webhooks file:', error)
      }
    }
  }

  list(): readonly StoredWebhook[] {
    return this.hooks
  }

  get(id: string): StoredWebhook | undefined {
    return this.hooks.find((hook) => hook.id === id)
  }

  /** An id, a unique id prefix of 6+ characters, or an exact name. */
  find(target: string): StoredWebhook {
    const matches = this.hooks.filter(
      (hook) =>
        hook.id === target ||
        hook.name === target ||
        (target.length >= 6 && hook.id.startsWith(target))
    )
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `No webhook matches "${target}". Run "orca webhooks list".`
          : `"${target}" matches more than one webhook; use its id.`
      )
    }
    return matches[0]
  }

  add(input: Omit<StoredWebhook, 'id' | 'secret' | 'createdAt'>): StoredWebhook {
    const hook: StoredWebhook = {
      ...input,
      id: randomBytes(12).toString('hex'),
      secret: newSecret(),
      createdAt: Date.now()
    }
    this.write([...this.hooks, hook])
    return hook
  }

  rotate(id: string): StoredWebhook {
    const hook = { ...this.find(id), secret: newSecret() }
    this.write(this.hooks.map((entry) => (entry.id === hook.id ? hook : entry)))
    return hook
  }

  remove(id: string): StoredWebhook {
    const hook = this.find(id)
    this.write(this.hooks.filter((entry) => entry.id !== hook.id))
    return hook
  }

  // Why: a failed write must fail the command, or a removed hook would still accept deliveries.
  private write(next: StoredWebhook[]): void {
    writeDurableSecureJsonFile(this.path, { version: 1, hooks: next })
    this.hooks = next
  }
}
