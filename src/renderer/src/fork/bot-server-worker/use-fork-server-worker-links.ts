// BAD-642 (FORK.md "Bot items: workers on a paired server"): an open item's links with its server
// workers read live from their servers: state, when each was last active, and the PR its workspace
// shows, in place of upstream's "PR not shown for server work yet". Only for a bot on this desktop:
// a server's own bot names its servers by that server's pairings, which this desktop can't reach.
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import type { AppState } from '@/store/types'
import { findWorktreeById } from '@/store/github/refresh/worktree-refresh'
import {
  deriveWorktreeCardPrDisplay,
  getWorktreeReviewCacheKeys
} from '@/components/sidebar/workspace-card/review/worktree-card-pr-derivation'
import type { BotOnHost } from '@/lib/bot-hosts'
import {
  botItemPrRefOfUrl,
  isLiveBotItemWorker,
  type BotItemLinkView,
  type BotItemPullRequest
} from '../../../../shared/bots/bot-items'
import {
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId
} from '../../../../shared/execution-host/execution-host'
import {
  forkServerWorkerLinks,
  type ForkServerWorkerRead
} from '../../../../shared/fork/bot-server-worker'
import { readForkServerWorker } from './server-worker-read'

// While a worker may still be working; a settled one is read once per change of the item's links.
const POLL_MS = 15_000

type Wanted = { ref: string; environmentId: string; dispatchId: string }

// Ids, URLs and titles never hold a NUL, so it joins their fields into one comparable string.
const SEP = '\u0000'

/** The item's server workers this desktop can ask, as one string, so a re-read item that names the
 *  same workers keeps its reads and its timer. */
function wantedKey(bot: BotOnHost, links: readonly BotItemLinkView[]): string {
  if (bot.hostId !== LOCAL_EXECUTION_HOST_ID) {
    return ''
  }
  return links
    .flatMap((link) =>
      link.kind === 'dispatch' && link.server
        ? [[link.ref, link.server.environmentId, link.latest ?? link.ref].join(SEP)]
        : []
    )
    .join('\n')
}

function parseWanted(key: string): Wanted[] {
  return key
    ? key.split('\n').map((line) => {
        const [ref = '', environmentId = '', dispatchId = ''] = line.split(SEP)
        return { ref, environmentId, dispatchId }
      })
    : []
}

/** The PR the window's workspace card shows for the server's workspace, by its PR read; '' for none. */
function serverWorkspaceReview(state: AppState, worktreeId: string, environmentId: string): string {
  const worktree = findWorktreeById(state, worktreeId, toRuntimeExecutionHostId(environmentId))
  if (!worktree) {
    return ''
  }
  const repo = state.repos.find((candidate) => candidate.id === worktree.repoId)
  const keys = getWorktreeReviewCacheKeys(worktree, repo, state.settings)
  const review = deriveWorktreeCardPrDisplay(
    worktree,
    keys.hostedReviewCacheKey ? state.hostedReviewCache[keys.hostedReviewCacheKey] : undefined,
    keys.prCacheKey ? state.prCache?.[keys.prCacheKey] : undefined
  ).prDisplay
  if (!review || review.provider !== 'github' || !review.url) {
    return ''
  }
  const checks = 'status' in review ? review.status : null
  return [review.number, review.url, review.state ?? '', review.title, checks ?? ''].join(SEP)
}

const PR_STATES: ReadonlySet<string> = new Set(['open', 'draft', 'merged', 'closed'])

function isPrState(value: string): value is NonNullable<Review['state']> {
  return PR_STATES.has(value)
}

function parseReview(key: string): Review | null {
  const [number = '', url = '', state = '', title = '', checks = ''] = key.split(SEP)
  const parsed = Number(number)
  return key && Number.isInteger(parsed) && url
    ? {
        number: parsed,
        url,
        state: isPrState(state) ? state : null,
        title: title || null,
        checks: checks || null
      }
    : null
}

type Review = {
  number: number
  url: string
  state: Extract<BotItemPullRequest, { shown: true }>['state'] | null
  title: string | null
  checks: string | null
}

export function useForkServerWorkerLinks(
  bot: BotOnHost,
  links: readonly BotItemLinkView[]
): readonly BotItemLinkView[] {
  const key = wantedKey(bot, links)
  const [reads, setReads] = useState<ReadonlyMap<string, ForkServerWorkerRead>>(() => new Map())
  useEffect(() => {
    const wanted = parseWanted(key)
    if (wanted.length === 0) {
      setReads((prev) => (prev.size === 0 ? prev : new Map()))
      return
    }
    let cancelled = false
    // Read again while a worker may still be working or its server did not answer; one read at a time.
    let again = true
    let busy = false
    const read = async (): Promise<void> => {
      busy = true
      const next = new Map<string, ForkServerWorkerRead>()
      let live = false
      await Promise.all(
        wanted.map(async ({ ref, environmentId, dispatchId }) => {
          try {
            const result = await readForkServerWorker(environmentId, dispatchId)
            if (result) {
              next.set(ref, result)
              live ||= isLiveBotItemWorker(result.state)
            }
          } catch {
            // Unreachable for now: the host's record shows, and the next read tries again.
            live = true
          }
        })
      )
      busy = false
      again = live
      if (!cancelled) {
        setReads(next)
      }
    }
    void read()
    // Paused while the window is hidden and slowed behind another app; idle once every worker settled.
    const stop = installWindowVisibilityInterval({
      run: () => {
        if (again && !busy) {
          void read()
        }
      },
      intervalMs: POLL_MS,
      slowWhileUnfocused: true
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [key])
  // Each read workspace's PR as the window's card shows it, one string per worker so the store's other
  // writes leave the item alone.
  const workspaces = useMemo(
    () =>
      parseWanted(key).flatMap(({ ref, environmentId }) => {
        const worktreeId = reads.get(ref)?.worktreeId
        return worktreeId ? [{ ref, worktreeId, environmentId }] : []
      }),
    [key, reads]
  )
  const reviewKeys = useAppStore(
    useShallow((state) =>
      workspaces.map(({ worktreeId, environmentId }) =>
        serverWorkspaceReview(state, worktreeId, environmentId)
      )
    )
  )
  return useMemo(() => {
    if (reads.size === 0) {
      return links
    }
    const reviews = new Map<string, Review>()
    workspaces.forEach(({ ref }, index) => {
      const review = parseReview(reviewKeys[index] ?? '')
      if (review) {
        reviews.set(ref, review)
      }
    })
    const withPrs = new Map(
      [...reads].map(([ref, read]) => {
        const review = reviews.get(ref)
        // The card's PR (its branch's or its linked one) first; else the workspace's linkedPR.
        return [ref, review ? { ...read, pr: { number: review.number, url: review.url } } : read]
      })
    )
    const byUrl = new Map([...reviews.values()].map((review) => [review.url, review]))
    return forkServerWorkerLinks(links, withPrs, (pr) => shownPr(pr, byUrl.get(pr.url)))
  }, [links, reads, workspaces, reviewKeys])
}

/** A PR with the state the window has read for it; null (a plain "PR #n" link) when it has none. */
function shownPr(
  pr: { number: number; url: string },
  review: Review | undefined
): BotItemPullRequest | null {
  const ref = botItemPrRefOfUrl(pr.url)
  if (!review?.state || !ref) {
    return null
  }
  return {
    shown: true,
    ref,
    number: pr.number,
    url: pr.url,
    state: review.state,
    checks: review.checks,
    review: null,
    title: review.title,
    checkedAt: null
  }
}
