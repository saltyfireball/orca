// PR nudges (FORK.md, BAD-680): the host service. Stock Orca's PR watcher reads each watched pull
// request on its cadence and hands every read of an open one here (`observed`) with the chat that
// owns it. With nudges on, a new comment from an allowed account goes to that chat once, and a
// conflict goes once per head commit as a rebase request, both through the chat's normal send (a
// running turn holds them as a queued card). Dedupe keys are kept on disk, so a restart or a
// repeated read never resends. A send the chat refuses is counted; at the cap the pull request
// stops and joins the Decision inbox. Keep electron out of this file: it also runs headless.
import { isForkPauseAllEngaged } from '../pause-all/pause-all-state'
import type { PRWatchWorkspace } from '../../github/pr-watch/pr-watch-types'
import type {
  ForkIdleRecoveryAnswerOutcome,
  ForkIdleRecoveryInboxItem
} from '../../../shared/fork/idle-recovery-wire'
import {
  PR_NUDGE_MAX_SEEN,
  newPrNudgeEntry,
  parsePrNudgeKey,
  prNudgeAllowedComments,
  prNudgeCommentKey,
  prNudgeConflictDue,
  prNudgeConflictKey,
  prNudgeNewComments,
  prNudgeReasonText,
  type PrNudgeEntry,
  type PrNudgeReason,
  type PrNudgeSettings
} from '../../../shared/fork/pr-nudge'
import type { IdleRecoveryChatPort } from '../idle-recovery/idle-recovery-ports'
import type { PrNudgeGitHub } from './pr-nudge-github'
import { buildPrNudgeConflictMessage, buildPrNudgeReviewMessage } from './pr-nudge-message'
import { prunePrNudgeState, type PrNudgeState } from './pr-nudge-state'

/** What a stock PR read saw of an open pull request. */
export type PrNudgeObservation = {
  prKey: string
  chatId: string
  headSha: string
  baseRef: string | null
  /** GitHub's mergeable state as stock reads it: only CONFLICTING asks for a rebase. */
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  state: 'open' | 'closed' | 'merged' | 'draft'
}

export type PrNudgeServiceDeps = {
  now: () => number
  settings: () => PrNudgeSettings
  load: () => Promise<PrNudgeState>
  save: (state: PrNudgeState) => Promise<void>
  github: () => Promise<PrNudgeGitHub>
  workspace: (chatId: string) => Promise<PRWatchWorkspace | 'not-git' | null>
  chat: IdleRecoveryChatPort
  answer: (chatId: string, text: string) => Promise<ForkIdleRecoveryAnswerOutcome>
  notify: (items: ForkIdleRecoveryInboxItem[]) => Promise<void>
  changed: () => void
  warn: (message: string, error?: unknown) => void
}

/** Comments are read from GitHub at most this often per pull request. */
export const PR_NUDGE_COMMENT_READ_MS = 60_000
/** A failed send is tried again on a later read, not sooner than this. */
export const PR_NUDGE_RETRY_MS = 60_000

export function prNudgeInboxItem(entry: PrNudgeEntry): ForkIdleRecoveryInboxItem | null {
  const pr = parsePrNudgeKey(entry.prKey)
  if (entry.phase !== 'stuck' || !entry.chatId || !pr) {
    return null
  }
  return {
    chatId: entry.chatId,
    kind: 'chat',
    agent: '',
    title: `PR ${pr.owner}/${pr.repo}#${pr.number}`,
    workspace: '',
    worktreeId: null,
    verdict: 'stalled',
    question: '',
    reason: `PR nudges stopped: ${prNudgeReasonText(entry)}.`,
    since: entry.stuckSince ?? entry.updatedAt,
    wakes: 0,
    wakeAt: null,
    paused: false,
    source: 'nudge',
    prKey: entry.prKey
  }
}

export function createPrNudgeService(deps: PrNudgeServiceDeps) {
  let loading: Promise<PrNudgeState> | null = null
  const chains = new Map<string, Promise<void>>()
  const loaded = (): Promise<PrNudgeState> => (loading ??= deps.load())

  function serial(prKey: string, run: () => Promise<void>): Promise<void> {
    const next = (chains.get(prKey) ?? Promise.resolve())
      .then(run)
      .catch((error: unknown) => deps.warn('[fork pr nudge] a step failed', error))
    chains.set(prKey, next)
    void next.finally(() => {
      if (chains.get(prKey) === next) {
        chains.delete(prKey)
      }
    })
    return next
  }

  async function commit(state: PrNudgeState): Promise<void> {
    prunePrNudgeState(state, deps.now())
    try {
      await deps.save(state)
    } catch (error) {
      deps.warn('[fork pr nudge] could not save its state', error)
    }
    deps.changed()
  }

  async function stick(entry: PrNudgeEntry, reason: PrNudgeReason): Promise<void> {
    entry.phase = 'stuck'
    entry.reason = reason
    entry.stuckSince = deps.now()
    const item = prNudgeInboxItem(entry)
    if (item) {
      await deps
        .notify([item])
        .catch((error: unknown) => deps.warn('[fork pr nudge] notify', error))
    }
  }

  /** Sends one message; true when the chat took it. A refusal counts against `keys`. */
  async function send(
    entry: PrNudgeEntry,
    keys: readonly string[],
    message: string,
    failure: PrNudgeReason
  ): Promise<boolean> {
    const settings = deps.settings()
    const chatId = entry.chatId
    const facts = chatId ? deps.chat.read(chatId) : null
    entry.lastAttemptAt = deps.now()
    let taken = false
    if (chatId && facts?.loaded) {
      // Never steered into a turn: a chat that got busy holds the message as a queued card.
      taken = (await deps.chat.send(chatId, message, facts.fence)) !== 'refused'
    }
    if (taken) {
      for (const key of keys) {
        delete entry.attempts[key]
      }
      return true
    }
    let worst = 0
    for (const key of keys) {
      entry.attempts[key] = (entry.attempts[key] ?? 0) + 1
      worst = Math.max(worst, entry.attempts[key]!)
    }
    if (worst >= settings.maxAttempts) {
      await stick(entry, chatId ? failure : 'no-chat')
    }
    return false
  }

  const retryWaiting = (entry: PrNudgeEntry, keys: readonly string[]): boolean =>
    keys.some((key) => (entry.attempts[key] ?? 0) > 0) &&
    deps.now() - entry.lastAttemptAt < PR_NUDGE_RETRY_MS

  async function nudgeConflict(entry: PrNudgeEntry, seen: PrNudgeObservation): Promise<void> {
    const settings = deps.settings()
    const pr = parsePrNudgeKey(entry.prKey)
    if (seen.mergeable === 'MERGEABLE') {
      entry.conflictRounds = 0
    }
    if (!pr || seen.mergeable !== 'CONFLICTING' || !prNudgeConflictDue(entry, seen.headSha)) {
      return
    }
    const key = prNudgeConflictKey(seen.headSha)
    if (entry.conflictRounds >= settings.maxAttempts) {
      return stick(entry, 'conflict-cap')
    }
    if (retryWaiting(entry, [key])) {
      return
    }
    const message = buildPrNudgeConflictMessage({
      pr,
      headSha: seen.headSha,
      baseRef: seen.baseRef,
      round: entry.conflictRounds + 1,
      maxRounds: settings.maxAttempts,
      update: settings.conflictUpdate
    })
    if (await send(entry, [key], message, 'conflict-unsent')) {
      entry.conflictHeads = [...entry.conflictHeads, key].slice(-50)
      entry.conflictRounds += 1
    }
  }

  async function nudgeComments(entry: PrNudgeEntry, seen: PrNudgeObservation): Promise<void> {
    const settings = deps.settings()
    const pr = parsePrNudgeKey(entry.prKey)
    const ws = await deps.workspace(seen.chatId).catch(() => null)
    if (!pr || !ws || ws === 'not-git') {
      return
    }
    entry.lastCommentReadAt = deps.now()
    const read = await deps
      .github()
      .then((github) => github.read(ws, pr))
      .catch(() => null)
    if (!read) {
      return
    }
    if (!entry.baselined) {
      // Comments that were there when nudging began were already seen by someone; only later ones go.
      entry.seen = read.comments.map(prNudgeCommentKey).slice(-PR_NUDGE_MAX_SEEN)
      entry.baselined = true
      return
    }
    const fresh = prNudgeNewComments(
      entry,
      prNudgeAllowedComments(read.comments, read.author, settings.commenters)
    )
    if (fresh.length === 0) {
      return
    }
    const keys = fresh.map(prNudgeCommentKey)
    if (retryWaiting(entry, keys)) {
      return
    }
    if (
      await send(entry, keys, buildPrNudgeReviewMessage({ pr, comments: fresh }), 'comments-unsent')
    ) {
      entry.seen = [...entry.seen, ...keys].slice(-PR_NUDGE_MAX_SEEN)
    }
  }

  return {
    /** A stock PR read saw this pull request. Never throws; steps of one PR run in order. */
    observed(seen: PrNudgeObservation): Promise<void> {
      const settings = deps.settings()
      // Pause all (BAD-685, FORK.md): no nudge while paused; dedupe keys stay, so the next read
      // after `orca resume-all` sends what is due.
      if (!settings.enabled || seen.state !== 'open' || isForkPauseAllEngaged()) {
        return Promise.resolve()
      }
      const prKey = seen.prKey.toLowerCase()
      return serial(prKey, async () => {
        const state = await loaded()
        const entry = state.entries[prKey] ?? newPrNudgeEntry(prKey, deps.now())
        if (entry.phase !== 'ok') {
          return
        }
        entry.chatId = seen.chatId
        const before = JSON.stringify(entry)
        if (settings.conflicts) {
          await nudgeConflict(entry, { ...seen, prKey })
        }
        const due = deps.now() - entry.lastCommentReadAt >= PR_NUDGE_COMMENT_READ_MS
        if (entry.phase === 'ok' && settings.reviews && due) {
          await nudgeComments(entry, { ...seen, prKey })
        }
        if (!state.entries[prKey] || JSON.stringify(entry) !== before) {
          entry.updatedAt = deps.now()
          state.entries[prKey] = entry
          await commit(state)
        }
      })
    },

    async list(): Promise<PrNudgeEntry[]> {
      return Object.values((await loaded()).entries).sort((a, b) => b.updatedAt - a.updatedAt)
    },

    /** Stuck pull requests, as Decision inbox rows. */
    async inboxItems(): Promise<ForkIdleRecoveryInboxItem[]> {
      const state = await loaded()
      return Object.values(state.entries).flatMap((entry) => prNudgeInboxItem(entry) ?? [])
    },

    /** Your answer to a stuck pull request's chat; nudging starts again with fresh counts. */
    async answer(chatId: string, text: string): Promise<ForkIdleRecoveryAnswerOutcome | null> {
      const state = await loaded()
      const entry = Object.values(state.entries).find(
        (row) => row.phase === 'stuck' && row.chatId === chatId
      )
      if (!entry) {
        return null
      }
      const outcome = await deps.answer(chatId, text)
      if (outcome === 'sent') {
        await serial(entry.prKey, async () => {
          entry.phase = 'ok'
          entry.reason = null
          entry.attempts = {}
          entry.conflictRounds = 0
          entry.stuckSince = null
          entry.updatedAt = deps.now()
          await commit(state)
        })
      }
      return outcome
    },

    /** The inbox row's Stop: no more nudges for that chat's stuck pull requests. */
    async dismiss(chatId: string): Promise<boolean> {
      const state = await loaded()
      const stuck = Object.values(state.entries).filter(
        (row) => row.phase === 'stuck' && row.chatId === chatId
      )
      for (const entry of stuck) {
        await serial(entry.prKey, async () => {
          entry.phase = 'stopped'
          entry.updatedAt = deps.now()
          await commit(state)
        })
      }
      return stuck.length > 0
    }
  }
}

export type PrNudgeService = ReturnType<typeof createPrNudgeService>
