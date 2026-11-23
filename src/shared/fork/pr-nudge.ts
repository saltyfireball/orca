// PR nudges (FORK.md, BAD-680): its settings, the per-PR record and the pure rules. Stock Orca's PR
// watcher reads each watched pull request on its cadence; the nudge service looks at what that read
// saw (merge state) and at the PR's new comments, and sends the owning chat one deduplicated message
// per new review comment batch and one rebase request per conflicted head. Pure, so the host
// service, its tests and the window share it.
import { parsePrBabysitKey } from './pr-babysit'

export type ForkPrNudgeCommenters = 'collaborators' | 'anyone'
/** How a conflicting branch is brought up to date: merge the base in (no force push) or rebase it. */
export type ForkPrNudgeConflictUpdate = 'merge' | 'rebase'

export type ForkPrNudgeSettings = {
  /** Fork PR nudges (BAD-680): tell the owning chat about new review comments and merge conflicts on its pull request. Off unless true. */
  forkPrNudgeEnabled?: boolean
  /** Fork PR nudges: send new review comments (on by default once nudges are on). */
  forkPrNudgeReviews?: boolean
  /** Fork PR nudges: send a rebase request when the pull request conflicts (on by default once nudges are on). */
  forkPrNudgeConflicts?: boolean
  /** Fork PR nudges: whose comments count: 'collaborators' (owner, member, collaborator; the default) or 'anyone'. */
  forkPrNudgeCommenters?: ForkPrNudgeCommenters
  /** Fork PR nudges (BAD-783): how the conflict request asks the chat to update its branch: 'merge' (merge the base branch in; never a force push; the default) or 'rebase'. */
  forkPrNudgeConflictUpdate?: ForkPrNudgeConflictUpdate
  /** Fork PR nudges: failed sends (and conflict requests in a row) before it stops and asks you (1 to 10); unset is 3. */
  forkPrNudgeMaxAttempts?: number
}

export const PR_NUDGE_DEFAULT_MAX_ATTEMPTS = 3

/** The one sentence every PR message carries about merging (BAD-783): it grants and holds nothing. */
export const PR_MESSAGE_MERGE_LINE =
  'This message gives you no permission to merge the pull request and places no hold on merging it: your own task decides whether you merge.'

export type PrNudgeSettings = {
  enabled: boolean
  reviews: boolean
  conflicts: boolean
  commenters: ForkPrNudgeCommenters
  conflictUpdate: ForkPrNudgeConflictUpdate
  maxAttempts: number
}

export type PrNudgeSettingsSource =
  | Partial<Record<keyof ForkPrNudgeSettings, unknown>>
  | ForkPrNudgeSettings
  | null
  | undefined

export function readPrNudgeSettings(source: PrNudgeSettingsSource): PrNudgeSettings {
  const s = (source ?? {}) as Partial<Record<keyof ForkPrNudgeSettings, unknown>>
  const attempts = s.forkPrNudgeMaxAttempts
  return {
    enabled: s.forkPrNudgeEnabled === true,
    reviews: s.forkPrNudgeReviews !== false,
    conflicts: s.forkPrNudgeConflicts !== false,
    commenters: s.forkPrNudgeCommenters === 'anyone' ? 'anyone' : 'collaborators',
    conflictUpdate: s.forkPrNudgeConflictUpdate === 'rebase' ? 'rebase' : 'merge',
    maxAttempts:
      typeof attempts === 'number' && Number.isInteger(attempts) && attempts >= 1 && attempts <= 10
        ? attempts
        : PR_NUDGE_DEFAULT_MAX_ATTEMPTS
  }
}

/** Where a comment was written: on a diff line, in the conversation, or as a review's summary. */
export type PrNudgeCommentKind = 'review-comment' | 'conversation' | 'review'

export type PrNudgeComment = {
  kind: PrNudgeCommentKind
  /** GitHub's numeric id; with the kind it is the dedupe key. */
  id: number
  author: string
  /** GitHub's author_association: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE, ... */
  association: string
  path: string | null
  line: number | null
  body: string
  url: string
  /** The thread a review comment replies in; null for a thread's first comment. */
  replyTo: number | null
}

export function prNudgeCommentKey(comment: Pick<PrNudgeComment, 'kind' | 'id'>): string {
  return `${comment.kind}:${comment.id}`
}

/** One rebase request per head commit. */
export function prNudgeConflictKey(headSha: string): string {
  return `conflict:${headSha.toLowerCase()}`
}

const COLLABORATOR_ROLES = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

/** Comments that count: not the pull request author's own, not empty, and from an allowed account. */
export function prNudgeAllowedComments(
  comments: readonly PrNudgeComment[],
  prAuthor: string | null,
  commenters: ForkPrNudgeCommenters
): PrNudgeComment[] {
  return comments.filter(
    (comment) =>
      comment.body.trim().length > 0 &&
      !(prAuthor && comment.author.toLowerCase() === prAuthor.toLowerCase()) &&
      (commenters === 'anyone' || COLLABORATOR_ROLES.has(comment.association.toUpperCase()))
  )
}

/**
 * - ok: nothing is stuck.
 * - stuck: sends kept failing (or a conflict stayed past its requests); in the Decision inbox.
 * - stopped: you dismissed the inbox row; no more nudges for this pull request.
 */
export type PrNudgePhase = 'ok' | 'stuck' | 'stopped'
export type PrNudgeReason = 'comments-unsent' | 'conflict-unsent' | 'conflict-cap' | 'no-chat'

export type PrNudgeEntry = {
  prKey: string
  chatId: string | null
  phase: PrNudgePhase
  reason: PrNudgeReason | null
  /** False until the first read; what existed then is not nudged. */
  baselined: boolean
  /** Dedupe keys already sent (or present at the baseline), newest last. */
  seen: string[]
  /** Heads a rebase request went out for. */
  conflictHeads: string[]
  /** Rebase requests since the pull request was last mergeable. */
  conflictRounds: number
  /** Failed sends per dedupe key (a comment batch counts once per key). */
  attempts: Record<string, number>
  lastCommentReadAt: number
  lastAttemptAt: number
  stuckSince: number | null
  updatedAt: number
}

export function newPrNudgeEntry(prKey: string, now: number): PrNudgeEntry {
  return {
    prKey,
    chatId: null,
    phase: 'ok',
    reason: null,
    baselined: false,
    seen: [],
    conflictHeads: [],
    conflictRounds: 0,
    attempts: {},
    lastCommentReadAt: 0,
    lastAttemptAt: 0,
    stuckSince: null,
    updatedAt: now
  }
}

export const PR_NUDGE_MAX_SEEN = 500

/** Comments not yet sent, oldest first. */
export function prNudgeNewComments(
  entry: Pick<PrNudgeEntry, 'seen'>,
  comments: readonly PrNudgeComment[]
): PrNudgeComment[] {
  const seen = new Set(entry.seen)
  return comments.filter((comment) => !seen.has(prNudgeCommentKey(comment)))
}

/** True when a rebase request for this head may go out now. */
export function prNudgeConflictDue(
  entry: Pick<PrNudgeEntry, 'conflictHeads'>,
  headSha: string
): boolean {
  return !entry.conflictHeads.includes(prNudgeConflictKey(headSha))
}

export function prNudgeReasonText(entry: Pick<PrNudgeEntry, 'reason'>): string {
  switch (entry.reason) {
    case 'comments-unsent':
      return 'the chat could not take the review comments'
    case 'conflict-unsent':
      return 'the chat could not take the rebase request'
    case 'conflict-cap':
      return 'the pull request still conflicts after the rebase requests'
    case 'no-chat':
      return 'no chat on this host owns the pull request'
    default:
      return 'stopped'
  }
}

export function parsePrNudgeKey(prKey: string) {
  return parsePrBabysitKey(prKey)
}
