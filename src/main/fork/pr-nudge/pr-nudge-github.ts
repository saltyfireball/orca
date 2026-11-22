// PR nudges (FORK.md, BAD-680): what they ask of GitHub: the pull request's comments, reviews and
// author, through the same gh runner the PR babysitter uses (the chat's checkout, argv only).
// Reads only; nothing is ever written to GitHub.
import type { PRWatchWorkspace } from '../../github/pr-watch/pr-watch-types'
import type { PrBabysitPr } from '../../../shared/fork/pr-babysit'
import type { PrNudgeComment } from '../../../shared/fork/pr-nudge'
import { livePrGhRunner, type PrBabysitGh } from '../pr-babysit/pr-babysit-github'

export type PrNudgeRead = { author: string | null; comments: PrNudgeComment[] }

export type PrNudgeGitHub = {
  read: (ws: PRWatchWorkspace, pr: PrBabysitPr) => Promise<PrNudgeRead | null>
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function login(value: unknown): string {
  return typeof value === 'object' && value !== null
    ? text((value as Record<string, unknown>).login)
    : ''
}

function rows(stdout: string): Record<string, unknown>[] {
  let data: unknown
  try {
    data = JSON.parse(stdout)
  } catch {
    return []
  }
  // `gh api --paginate --slurp` gives one array per page.
  const flat = Array.isArray(data) ? data.flat() : []
  return flat.filter(
    (row): row is Record<string, unknown> => typeof row === 'object' && row !== null
  )
}

/** Review comments on diff lines (`pulls/N/comments`). */
export function parsePrNudgeReviewComments(stdout: string): PrNudgeComment[] {
  return rows(stdout).flatMap((row) => {
    const id = whole(row.id)
    if (id === null) {
      return []
    }
    return [
      {
        kind: 'review-comment' as const,
        id,
        author: login(row.user),
        association: text(row.author_association),
        path: text(row.path) || null,
        line: whole(row.line) ?? whole(row.original_line),
        body: text(row.body),
        url: text(row.html_url),
        replyTo: whole(row.in_reply_to_id)
      }
    ]
  })
}

/** Conversation comments (`issues/N/comments`). */
export function parsePrNudgeConversation(stdout: string): PrNudgeComment[] {
  return rows(stdout).flatMap((row) => {
    const id = whole(row.id)
    return id === null
      ? []
      : [
          {
            kind: 'conversation' as const,
            id,
            author: login(row.user),
            association: text(row.author_association),
            path: null,
            line: null,
            body: text(row.body),
            url: text(row.html_url),
            replyTo: null
          }
        ]
  })
}

/** Review summaries (`pulls/N/reviews`); an unsubmitted (PENDING) review is not sent. */
export function parsePrNudgeReviews(stdout: string): PrNudgeComment[] {
  return rows(stdout).flatMap((row) => {
    const id = whole(row.id)
    if (id === null || text(row.state).toUpperCase() === 'PENDING') {
      return []
    }
    return [
      {
        kind: 'review' as const,
        id,
        author: login(row.user),
        association: text(row.author_association),
        path: null,
        line: null,
        body: text(row.body),
        url: text(row.html_url),
        replyTo: null
      }
    ]
  })
}

export function parsePrNudgeAuthor(stdout: string): string | null {
  try {
    const data: unknown = JSON.parse(stdout)
    const name = typeof data === 'object' && data !== null ? login((data as never)['user']) : ''
    return name || null
  } catch {
    return null
  }
}

function apiArgs(pr: PrBabysitPr, path: string, paginate: boolean): string[] {
  return [
    'api',
    ...(pr.host === 'github.com' ? [] : ['--hostname', pr.host]),
    ...(paginate ? ['--paginate', '--slurp'] : []),
    `repos/${pr.owner}/${pr.repo}/${path}${paginate ? '?per_page=100' : ''}`
  ]
}

export function prNudgeGitHub(gh: PrBabysitGh): PrNudgeGitHub {
  return {
    read: async (ws, pr) => {
      const n = pr.number
      const [meta, review, conversation, reviews] = await Promise.all([
        gh(ws, pr, apiArgs(pr, `pulls/${n}`, false)),
        gh(ws, pr, apiArgs(pr, `pulls/${n}/comments`, true)),
        gh(ws, pr, apiArgs(pr, `issues/${n}/comments`, true)),
        gh(ws, pr, apiArgs(pr, `pulls/${n}/reviews`, true))
      ])
      return {
        author: parsePrNudgeAuthor(meta),
        comments: [
          ...parsePrNudgeReviewComments(review),
          ...parsePrNudgeConversation(conversation),
          ...parsePrNudgeReviews(reviews)
        ]
      }
    }
  }
}

/** The live port; the gh runner loads lazily so tests never load stock's GitHub client. */
export async function livePrNudgeGitHub(): Promise<PrNudgeGitHub> {
  return prNudgeGitHub(await livePrGhRunner())
}
