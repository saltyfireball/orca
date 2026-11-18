// Review guides (SLRM-2396, FORK.md): the fork.reviewGuide.* RPC contract (the CLI and the phone),
// the desktop window's IPC bridge, and the reply schema the phone checks answers against.
import { z } from 'zod'
import type { ForkReviewGuide, ForkReviewGuideJob } from './review-guide'

const PrRepo = z.object({
  owner: z.string().trim().min(1).max(100),
  repo: z.string().trim().min(1).max(100),
  host: z.string().trim().min(1).max(253).optional()
})
const Pr = z.number().int().min(1).max(1_000_000_000)
const Sha = z.string().regex(/^[0-9a-f]{7,64}$/i)

// Plain objects with no transforms or defaults: the mobile RPC fence refuses a schema whose parsed
// shape is wider than what a sender may send.
const Target = {
  /** A workspace selector (path:, id:, branch: and the rest) whose checkout holds the repository. */
  worktree: z.string().trim().min(1).max(1024).optional(),
  /** A project id or name, instead of a workspace. */
  repo: z.string().trim().min(1).max(512).optional(),
  pr: Pr,
  /** The repository the pull request lives in, when it is not the checkout's origin. */
  prRepo: PrRepo.optional()
}

export const ForkReviewGuideGetParams = z.object({
  ...Target,
  /** The pull request's current head; a guide written for another head reads as stale. */
  headSha: Sha.optional()
})
export const ForkReviewGuideWriteParams = z.object(Target)
export const ForkReviewGuideCancelParams = z.object(Target)

export type ForkReviewGuideTarget = z.infer<typeof ForkReviewGuideWriteParams>

/** What the guide surfaces show: the kept guide, a write in progress or failed, and staleness. */
export type ForkReviewGuideState = {
  enabled: boolean
  guide: ForkReviewGuide | null
  job: ForkReviewGuideJob | null
  /** Null when the caller sent no head to compare. */
  stale: boolean | null
}

const Line = z.object({
  index: z.number(),
  number: z.number().nullable(),
  sign: z.enum(['+', '-', ' ']),
  text: z.string()
})

export const ForkReviewGuideSchema = z.object({
  version: z.literal(1),
  host: z.string(),
  owner: z.string(),
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  headSha: z.string(),
  createdAt: z.number(),
  agentLabel: z.string(),
  summary: z.string(),
  stops: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      body: z.string(),
      lookClosely: z.string().nullable(),
      files: z.array(
        z.object({
          path: z.string(),
          lines: z.array(z.tuple([z.number(), z.number()])),
          excerpt: z.array(Line)
        })
      )
    })
  ),
  mechanical: z.array(z.object({ title: z.string(), paths: z.array(z.string()) }))
})

export const ForkReviewGuideJobSchema = z.union([
  z.object({ state: z.literal('running'), startedAt: z.number() }),
  z.object({ state: z.literal('failed'), error: z.string(), at: z.number() })
])

export const ForkReviewGuideStateSchema = z.object({
  enabled: z.boolean(),
  guide: ForkReviewGuideSchema.nullable(),
  job: ForkReviewGuideJobSchema.nullable(),
  stale: z.boolean().nullable()
})

/** The desktop window names the project by id; main looks up its checkout. */
export const ForkReviewGuideWindowRequestSchema = z.object({
  repoId: z.string().min(1).max(512),
  pr: Pr,
  prRepo: PrRepo.nullish(),
  headSha: Sha.nullish()
})

export type ForkReviewGuideWindowRequest = z.infer<typeof ForkReviewGuideWindowRequestSchema>

export const FORK_REVIEW_GUIDE_CHANNELS = {
  get: 'fork-review-guide:get',
  write: 'fork-review-guide:write',
  cancel: 'fork-review-guide:cancel'
} as const

export type ForkReviewGuideApi = {
  get: (request: ForkReviewGuideWindowRequest) => Promise<ForkReviewGuideState>
  write: (request: ForkReviewGuideWindowRequest) => Promise<ForkReviewGuideState>
  cancel: (request: ForkReviewGuideWindowRequest) => Promise<ForkReviewGuideState>
}

/** The phone may call these on the host that runs its workspace (one hook in the mobile route table). */
export const FORK_REVIEW_GUIDE_RPC_METHODS = [
  'fork.reviewGuide.get',
  'fork.reviewGuide.write',
  'fork.reviewGuide.cancel'
] as const
