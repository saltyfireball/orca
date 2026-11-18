// PR babysitter (FORK.md, SLRM-2386): the host service's core (the commands are in
// `pr-babysit-service.ts`). Stock Orca's PR watcher appends a CI line
// ("CI failing" / "CI green") to the chat that opened or pushed to a pull request; the hook in
// `pr-event-delivery.ts` hands each appended line here. For a babysat pull request a failure sends
// that chat one fix request (stock fix-checks prompt, with the failed log tails), at most
// `maxRounds` in a row; green starts the count over and, with auto-merge on, merges when GitHub
// says every check is green, no change is requested and the merge is clean. When it cannot go on
// (cap reached, no CI result after a fix request, the chat cannot take a message, the merge
// failed) it stops and the pull request joins the Decision inbox. Keep electron out of this file:
// it also runs in the headless server.
import type { PRWatchWorkspace } from '../../github/pr-watch/pr-watch-types'
import type { ForkIdleRecoveryInboxItem } from '../../../shared/fork/idle-recovery-wire'
import type { ForkIdleRecoveryAnswerOutcome } from '../../../shared/fork/idle-recovery-wire'
import {
  decidePrBabysitStep,
  parsePrBabysitKey,
  prBabysitEventId,
  prBabysitMergeBlock,
  prBabysitPlain,
  prBabysitReasonText,
  prBabysitRepoListed,
  type PrBabysitEntry,
  type PrBabysitLine,
  type PrBabysitReason,
  type PrBabysitSettings
} from '../../../shared/fork/pr-babysit'
import type { IdleRecoveryChatPort } from '../idle-recovery/idle-recovery-ports'
import type { PrBabysitGitHub } from './pr-babysit-github'
import { buildPrBabysitFixMessage } from './pr-babysit-message'
import { prunePrBabysitState, type PrBabysitState } from './pr-babysit-state'

export type PrBabysitServiceDeps = {
  now: () => number
  settings: () => PrBabysitSettings
  load: () => Promise<PrBabysitState>
  save: (state: PrBabysitState) => Promise<void>
  github: () => Promise<PrBabysitGitHub>
  /** The chat's checkout, from the PR watcher; 'not-git' or null when it has none here. */
  workspace: (chatId: string) => Promise<PRWatchWorkspace | 'not-git' | null>
  /** Idle recovery's chat port: the app's normal send, queued behind a running turn. */
  chat: IdleRecoveryChatPort
  /** The Decision inbox's answer send (idle recovery's). */
  answer: (chatId: string, text: string) => Promise<ForkIdleRecoveryAnswerOutcome>
  /** The Decision inbox's notification targets, told once when a pull request gets stuck. */
  notify: (items: ForkIdleRecoveryInboxItem[]) => Promise<void>
  changed: () => void
  warn: (message: string, error?: unknown) => void
}

export function newPrBabysitEntry(
  prKey: string,
  source: PrBabysitEntry['source'],
  now: number
): PrBabysitEntry {
  return {
    prKey,
    source,
    chatId: null,
    rounds: 0,
    phase: 'watching',
    reason: null,
    detail: '',
    lastEvent: null,
    headSha: null,
    fixSentAt: null,
    stuckSince: null,
    updatedAt: now
  }
}

export function prBabysitInboxItem(entry: PrBabysitEntry): ForkIdleRecoveryInboxItem | null {
  const pr = parsePrBabysitKey(entry.prKey)
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
    reason: `PR babysitter stopped: ${prBabysitReasonText(entry)}.`,
    since: entry.stuckSince ?? entry.updatedAt,
    wakes: 0,
    wakeAt: null,
    paused: false,
    source: 'babysit',
    prKey: entry.prKey
  }
}

export function createPrBabysitCore(deps: PrBabysitServiceDeps) {
  let loading: Promise<PrBabysitState> | null = null
  const chains = new Map<string, Promise<void>>()
  const mergeTriedAt = new Map<string, number>()

  const loaded = (): Promise<PrBabysitState> => (loading ??= deps.load())

  // One change at a time per pull request; a failure is logged and never stops the next.
  function serial(prKey: string, run: () => Promise<void>): Promise<void> {
    const next = (chains.get(prKey) ?? Promise.resolve())
      .then(run)
      .catch((error: unknown) => deps.warn('[fork pr babysit] a step failed', error))
    chains.set(prKey, next)
    void next.finally(() => {
      if (chains.get(prKey) === next) {
        chains.delete(prKey)
      }
    })
    return next
  }

  async function commit(state: PrBabysitState): Promise<void> {
    prunePrBabysitState(state, deps.now())
    try {
      await deps.save(state)
    } catch (error) {
      deps.warn('[fork pr babysit] could not save its state', error)
    }
    deps.changed()
  }

  async function stick(entry: PrBabysitEntry, reason: PrBabysitReason, detail = ''): Promise<void> {
    entry.phase = 'stuck'
    entry.reason = reason
    entry.detail = prBabysitPlain(detail)
    entry.stuckSince = deps.now()
    entry.fixSentAt = null
    const item = prBabysitInboxItem(entry)
    if (item) {
      await deps
        .notify([item])
        .catch((error: unknown) => deps.warn('[fork pr babysit] notify', error))
    }
  }

  async function checkout(entry: PrBabysitEntry): Promise<PRWatchWorkspace | null> {
    const ws = entry.chatId ? await deps.workspace(entry.chatId).catch(() => null) : null
    return ws && ws !== 'not-git' ? ws : null
  }

  async function sendFix(entry: PrBabysitEntry, line: PrBabysitLine, round: number): Promise<void> {
    const settings = deps.settings()
    const pr = parsePrBabysitKey(entry.prKey)
    const chatId = entry.chatId
    const facts = chatId ? deps.chat.read(chatId) : null
    if (!pr || !chatId) {
      return stick(entry, 'no-chat')
    }
    if (!facts?.loaded) {
      return stick(entry, 'chat-unavailable')
    }
    const ws = await checkout(entry)
    const read = ws
      ? await deps
          .github()
          .then((github) => github.checks(ws, pr, line.headSha))
          .catch(() => null)
      : null
    const message = buildPrBabysitFixMessage({
      pr,
      headSha: line.headSha,
      round,
      maxRounds: settings.maxRounds,
      read
    })
    // Never steered into a turn: a chat that got busy holds the message as a queued card.
    const outcome = await deps.chat.send(chatId, message, facts.fence)
    if (outcome === 'refused') {
      return stick(entry, 'chat-unavailable')
    }
    entry.phase = 'fixing'
    entry.rounds = round
    entry.reason = null
    entry.detail = ''
    entry.fixSentAt = deps.now()
  }

  async function tryMerge(entry: PrBabysitEntry, headSha: string): Promise<void> {
    const settings = deps.settings()
    const pr = parsePrBabysitKey(entry.prKey)
    mergeTriedAt.set(entry.prKey, deps.now())
    const blocked = (detail: string): void => {
      entry.phase = 'green'
      entry.reason = 'merge-blocked'
      entry.detail = prBabysitPlain(detail)
    }
    const ws = await checkout(entry)
    if (!pr || !ws) {
      return blocked('no checkout of it on this host to merge from')
    }
    const github = await deps.github()
    const facts = await github.facts(ws, pr).catch(() => null)
    if (!facts) {
      return blocked('could not read the pull request')
    }
    const block = prBabysitMergeBlock(facts, headSha)
    if (block) {
      return blocked(block)
    }
    const result = await github.merge(ws, pr, settings.mergeMethod, headSha)
    if (result.ok) {
      entry.phase = 'merged'
      entry.reason = null
      entry.detail = ''
      return
    }
    return stick(entry, 'merge-failed', result.error)
  }

  /** Keeps the chat it has while that chat is on this host; else the one the line came to. */
  function pickChat(entry: PrBabysitEntry, chatId: string): void {
    if (!entry.chatId || deps.chat.read(entry.chatId) === null) {
      entry.chatId = chatId
    }
  }

  async function handleLine(chatId: string, line: PrBabysitLine): Promise<void> {
    const settings = deps.settings()
    const listed = prBabysitRepoListed(line.prKey, settings.repos)
    const state = await loaded()
    let entry = state.entries[line.prKey]
    if (!entry) {
      if (!listed) {
        return
      }
      entry = newPrBabysitEntry(line.prKey, 'repo', deps.now())
      state.entries[line.prKey] = entry
    } else if (entry.source === 'repo' && !listed) {
      // Taken off the repo list: no longer babysat unless `orca babysit` names it.
      return
    }
    pickChat(entry, chatId)
    const step = decidePrBabysitStep(entry, line, settings)
    if (step.kind === 'ignore') {
      return
    }
    entry.lastEvent = prBabysitEventId(line)
    entry.headSha = line.headSha.toLowerCase()
    if (step.kind === 'fix') {
      await sendFix(entry, line, step.round)
    } else if (step.kind === 'stuck') {
      await stick(entry, step.reason)
    } else {
      entry.phase = 'green'
      entry.rounds = 0
      entry.reason = null
      entry.detail = ''
      entry.fixSentAt = null
      entry.stuckSince = null
      if (step.merge) {
        await tryMerge(entry, line.headSha)
      }
    }
    entry.updatedAt = deps.now()
    await commit(state)
  }

  return {
    deps,
    loaded,
    isLoaded: (): boolean => loading !== null,
    serial,
    commit,
    stick,
    tryMerge,
    handleLine,
    mergeTriedAt: (prKey: string): number => mergeTriedAt.get(prKey) ?? 0
  }
}

export type PrBabysitCore = ReturnType<typeof createPrBabysitCore>
