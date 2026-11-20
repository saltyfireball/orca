// BAD-642 (FORK.md "Bot items: workers on a paired server"): a bot item's worker that a paired
// server runs as its own (`orchestration worker-start --on`). The bot's host knows it only by its own
// record, so the item marks it with the server, and the desktop reads it live from that server.
import type { BotChatTreeWorker } from '../bots/bot-chat-tree'
import type { BotItemLinkView, BotItemPullRequest, BotItemWorkerState } from '../bots/bot-items'
import { botItemPrRefOfUrl } from '../bots/bot-items'

/** The paired server running a bot item's worker, as the bot's host names it. */
export type ForkBotItemServerWorker = {
  /** The bot host's environment id for the server: a target only where the bot's host is this desktop. */
  environmentId: string
  /** When the server last showed the worker active (its terminal's last output), once read live. */
  seenAt?: number
}

type DispatchLink = Extract<BotItemLinkView, { kind: 'dispatch' }>

/** The worker row's fields for a server worker: its host as `runtime:<id>`, and the server it runs on. */
export function forkServerWorkerRow(
  link: DispatchLink
): Pick<BotChatTreeWorker, 'hostId' | 'forkServer'> | Record<string, never> {
  return link.server
    ? { hostId: `runtime:${link.server.environmentId}`, forkServer: link.server }
    : {}
}

/** What the server says of the worker, as `orchestration.workerShow` and `worktree.show` give it. */
export type ForkServerWorkerRead = {
  state: BotItemWorkerState
  /** The server's workspace for the worker; null before it has one. */
  worktreeId: string | null
  seenAt: number | null
  /** The workspace's GitHub PR, from its linkedPR and its repository's slug. */
  pr: { number: number; url: string } | null
}

/** The parts of the server's `orchestration.workerShow` answer this reads. */
export type ForkServerWorkerShow = {
  worker?: { state?: string | null; worktreeId?: string | null } | null
  terminal?: { worktreeId?: string | null; lastOutputAt?: number | null } | null
  observation?: { status?: string | null } | null
  projection?: { liveness?: { observedAt?: number | null } | null } | null
}

/** The worker's state on its server: settled states as they are, a worker the server can't vouch for
 *  as unknown, anything else still working. */
export function forkServerWorkerState(show: ForkServerWorkerShow): BotItemWorkerState | null {
  const state = show.worker?.state
  if (!state) {
    return null
  }
  switch (state) {
    case 'succeeded':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'stopped':
    case 'abandoned':
      return 'stopped'
  }
  return show.observation?.status === 'unverifiable' ? 'unknown' : 'working'
}

export function forkServerWorkerWorktree(show: ForkServerWorkerShow): string | null {
  return show.worker?.worktreeId ?? show.terminal?.worktreeId ?? null
}

export function forkServerWorkerSeenAt(show: ForkServerWorkerShow): number | null {
  const at = show.terminal?.lastOutputAt ?? show.projection?.liveness?.observedAt ?? null
  return typeof at === 'number' && Number.isFinite(at) ? at : null
}

/** The item's links with what the server said: each read server worker's state, when it was last seen
 *  and, in place of upstream's "PR not shown" mark, the PR its workspace links (or none). A worker not
 *  read keeps its host's record. */
export function forkServerWorkerLinks(
  links: readonly BotItemLinkView[],
  reads: ReadonlyMap<string, ForkServerWorkerRead>,
  shownPr: (pr: { number: number; url: string }) => BotItemPullRequest | null = () => null
): BotItemLinkView[] {
  if (reads.size === 0) {
    return [...links]
  }
  const out: BotItemLinkView[] = []
  const prs: BotItemLinkView[] = []
  for (const link of links) {
    const read = link.kind === 'dispatch' && link.server ? reads.get(link.ref) : undefined
    if (link.kind !== 'dispatch' || !link.server || !read) {
      out.push(link)
      continue
    }
    out.push({
      ...link,
      state: read.state,
      server: { ...link.server, ...(read.seenAt !== null ? { seenAt: read.seenAt } : {}) },
      pr: null
    })
    const ref = read.pr ? botItemPrRefOfUrl(read.pr.url) : null
    if (read.pr && ref) {
      prs.push({ kind: 'pr', ref, pr: shownPr(read.pr) })
    }
  }
  return [...out, ...prs]
}

/** "13 s ago", "4 min ago", "2 h ago", "3 d ago": how long since the server last saw the worker. */
export function forkServerWorkerAgo(
  seenAt: number,
  now: number
): { count: number; unit: 's' | 'min' | 'h' | 'd' } {
  const seconds = Math.max(0, Math.round((now - seenAt) / 1000))
  if (seconds < 60) {
    return { count: seconds, unit: 's' }
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return { count: minutes, unit: 'min' }
  }
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? { count: hours, unit: 'h' } : { count: Math.floor(hours / 24), unit: 'd' }
}
