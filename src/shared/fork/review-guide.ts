// Review guides (SLRM-2396, FORK.md): an agent writes a guided tour of a pull request, stops in
// reading order with the lines worth reading, "look closely" marks where a maintainer must decide,
// and mechanical changes grouped at the end. Idea from T3 Code's review guides (MIT). Shared by
// main (which writes and keeps guides), the CLI, the desktop Guide tab and the phone.
import type { DiffHunkLine } from '../github/comments/pr-comment-diff-hunk'

export type ForkReviewGuideSettings = {
  /** Fork (SLRM-2396): the Guide tab on pull requests, its phone view and `orca review-guide`; unset is on. */
  forkReviewGuides?: boolean
  /** Fork review guides: write a guide by itself when a pull request without one is opened (each guide costs agent usage); unset is off. */
  forkReviewGuideAutoWrite?: boolean
  /** Fork review guides: your own instructions for the guide writer, such as what to show first or what to skip; unset is none. */
  forkReviewGuideInstructions?: string
  /** Fork review guides: KiB of patch text the writer reads (16 to 1024); files past it are listed without their patch; unset is 96. */
  forkReviewGuideMaxPatchKiB?: number
  /** Fork review guides: minutes the writer may take (1 to 15); unset is 5. */
  forkReviewGuideTimeoutMinutes?: number
}

export const FORK_REVIEW_GUIDE_DEFAULT_PATCH_KIB = 96
export const FORK_REVIEW_GUIDE_DEFAULT_TIMEOUT_MINUTES = 5
export const FORK_REVIEW_GUIDE_MAX_INSTRUCTIONS = 4000

export type ForkReviewGuideResolvedSettings = {
  enabled: boolean
  autoWrite: boolean
  instructions: string
  maxPatchBytes: number
  timeoutMs: number
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}

export function readForkReviewGuideSettings(settings: unknown): ForkReviewGuideResolvedSettings {
  const value = (settings ?? {}) as ForkReviewGuideSettings
  return {
    enabled: value.forkReviewGuides !== false,
    autoWrite: value.forkReviewGuideAutoWrite === true,
    instructions:
      typeof value.forkReviewGuideInstructions === 'string'
        ? value.forkReviewGuideInstructions.trim().slice(0, FORK_REVIEW_GUIDE_MAX_INSTRUCTIONS)
        : '',
    maxPatchBytes:
      clampInt(value.forkReviewGuideMaxPatchKiB, 16, 1024, FORK_REVIEW_GUIDE_DEFAULT_PATCH_KIB) *
      1024,
    timeoutMs:
      clampInt(
        value.forkReviewGuideTimeoutMinutes,
        1,
        15,
        FORK_REVIEW_GUIDE_DEFAULT_TIMEOUT_MINUTES
      ) * 60_000
  }
}

/** One file of a stop: the new-side line ranges to read and the patch lines they cover. */
export type ForkReviewGuideFile = {
  path: string
  lines: [number, number][]
  excerpt: DiffHunkLine[]
}

export type ForkReviewGuideStop = {
  id: string
  title: string
  body: string
  /** Why a maintainer must decide something here; null for a stop that only needs reading. */
  lookClosely: string | null
  files: ForkReviewGuideFile[]
}

export type ForkReviewGuideGroup = { title: string; paths: string[] }

export type ForkReviewGuide = {
  version: 1
  host: string
  owner: string
  repo: string
  number: number
  title: string
  /** The head commit the guide was written for; another head makes it stale. */
  headSha: string
  createdAt: number
  agentLabel: string
  summary: string
  stops: ForkReviewGuideStop[]
  /** Renames, formatting, generated files and the like, read last or skipped. */
  mechanical: ForkReviewGuideGroup[]
}

export type ForkReviewGuideJob =
  | { state: 'running'; startedAt: number }
  | { state: 'failed'; error: string; at: number }

export type ForkReviewGuideRef = {
  host: string
  owner: string
  repo: string
  number: number
}

/** One key per pull request; owner and repo compare case-insensitively, as GitHub does. */
export function forkReviewGuideKey(ref: ForkReviewGuideRef): string {
  return `${ref.host.toLowerCase()}/${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}#${ref.number}`
}

/** Every path the guide sends the reader to, stops first, each once. */
export function forkReviewGuidePaths(guide: Pick<ForkReviewGuide, 'stops' | 'mechanical'>): {
  stopPaths: string[]
  mechanicalPaths: string[]
} {
  const stopPaths = [...new Set(guide.stops.flatMap((stop) => stop.files.map((f) => f.path)))]
  const seen = new Set(stopPaths)
  const mechanicalPaths = [
    ...new Set(guide.mechanical.flatMap((group) => group.paths).filter((p) => !seen.has(p)))
  ]
  return { stopPaths, mechanicalPaths }
}

/** The guide as plain text, for `orca review-guide` and for copying. */
export function formatForkReviewGuide(guide: ForkReviewGuide, stale: boolean | null): string {
  const out: string[] = [
    `${guide.owner}/${guide.repo}#${guide.number}: ${guide.title}`,
    `Written ${new Date(guide.createdAt).toISOString()} by ${guide.agentLabel} for ${guide.headSha.slice(0, 7)}${stale ? ' (stale: the pull request has new commits)' : ''}`,
    ''
  ]
  if (guide.summary) {
    out.push(guide.summary, '')
  }
  guide.stops.forEach((stop, index) => {
    out.push(`${index + 1}. ${stop.title}${stop.lookClosely ? '  [look closely]' : ''}`)
    if (stop.lookClosely) {
      out.push(`   Look closely: ${stop.lookClosely}`)
    }
    if (stop.body) {
      out.push(...stop.body.split('\n').map((line) => `   ${line}`))
    }
    for (const file of stop.files) {
      const ranges = file.lines.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')
      out.push(`   - ${file.path}${ranges ? `:${ranges}` : ''}`)
    }
    out.push('')
  })
  for (const group of guide.mechanical) {
    out.push(`Mechanical: ${group.title}`, ...group.paths.map((p) => `   - ${p}`), '')
  }
  return out.join('\n').trimEnd()
}
