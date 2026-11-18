// Digest (SLRM-2388, FORK.md): schemas for a digest read from another host. A paired server's part
// and the whole digest a phone reads are checked here before anything shows them; a bad row is
// dropped, never the whole digest.
import { z } from 'zod'
import type { ForkDigest, ForkDigestSection } from './digest'

const MAX_TEXT = 2000
const text = z.string().max(MAX_TEXT)
const time = z.number().finite()

function rows<O>(row: z.ZodType<O>) {
  // A row that does not parse is left out; the others stay.
  return z
    .array(z.unknown())
    .max(500)
    .catch([])
    .transform((items) =>
      items.flatMap((item) => {
        const parsed = row.safeParse(item)
        return parsed.success ? [parsed.data] : []
      })
    )
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}

const TaskSchema = z.object({
  id: text,
  title: text,
  status: z.enum(['completed', 'failed']),
  at: time,
  result: text.nullable()
})

const PullRequestSchema = z.object({
  repo: text,
  number: z.number().int(),
  title: text,
  url: text.refine(isHttpsUrl),
  state: z.enum(['merged', 'open']),
  draft: z.boolean(),
  at: time
})

const WaitingSchema = z.object({
  chatId: text,
  title: text,
  workspace: text,
  question: text,
  verdict: z.enum(['waiting_user', 'stalled', 'guard']),
  source: z.literal('babysit').optional().catch(undefined),
  since: time
})

const CostSchema = z.object({
  days: z.number().int().min(1),
  chats: z.number().int().min(0),
  totalTokens: z.number().min(0),
  costUsd: z.number().min(0).nullable(),
  subscriptionTokens: z.number().min(0),
  unpricedTokens: z.number().min(0)
})

export const ForkDigestSectionSchema = z.object({
  tasks: rows(TaskSchema),
  pullRequests: rows(PullRequestSchema),
  waiting: rows(WaitingSchema),
  cost: CostSchema.nullable().catch(null),
  notes: z.array(text).max(20).catch([])
})

export const ForkDigestSchema = z.object({
  since: time,
  until: time,
  hosts: z
    .array(
      z.object({
        hostKey: text,
        name: text,
        status: z.enum(['ok', 'unreachable', 'no-digest']),
        section: ForkDigestSectionSchema.nullable().catch(null)
      })
    )
    .max(100),
  serversDown: z
    .array(z.object({ name: text, downSince: time }))
    .max(100)
    .catch([]),
  totals: z.object({
    finished: z.number(),
    failed: z.number(),
    merged: z.number(),
    open: z.number(),
    waiting: z.number(),
    costUsd: z.number().nullable(),
    totalTokens: z.number()
  })
})

/** A paired server's answer to fork.digest.local, or null when it is not one. */
export function parseForkDigestSection(value: unknown): ForkDigestSection | null {
  const parsed = ForkDigestSectionSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseForkDigest(value: unknown): ForkDigest | null {
  const parsed = ForkDigestSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
