// Idle recovery (FORK.md), item D: one pass over the candidates.
// Contract: for each candidate read its ending, fingerprint it, and classify an ending not
// seen before (once per fingerprint). Reset a chat's wake count when its prompt is no longer a
// wake (`isWakePrompt`). In mode 'wake', send a wake to a stalled chat only when
// `decideIdleRecoveryWake` allows it; in mode 'inbox', never send. Update the state and say
// what changed. Does nothing in mode 'off'.
// An ending is read again only when the chat went idle anew, and classified again only when the
// classifier asked for a later look (`wake_after_seconds`) and that time has come. A paused chat
// is neither read nor classified. `input.state` is updated in place.
import {
  IDLE_RECOVERY_INPUT_VERSION,
  decideIdleRecoveryWake,
  idleRecoveryEndingFingerprint,
  isWakePrompt,
  tailForIdleRecoveryClassifier,
  type IdleRecoveryPersistedState,
  type IdleRecoveryVerdict
} from '../../../shared/fork/idle-recovery'
import type { IdleRecoverySettings } from '../../../shared/fork/idle-recovery-settings'
import type { ForkIdleRecoveryInboxItem } from '../../../shared/fork/idle-recovery-wire'
import { listIdleRecoveryCandidates } from './idle-recovery-candidates'
import { classifyIdleRecoveryEnding } from './idle-recovery-classifier'
import { readIdleRecoveryEnding } from './idle-recovery-ending'
import {
  asIdleRecoveryStoredState,
  listIdleRecoveryInboxItems,
  type IdleRecoveryStoredChat
} from './idle-recovery-state'
import type { IdleRecoveryCandidate, IdleRecoverySweepResult } from './idle-recovery-types'
import { sendIdleRecoveryWake } from './idle-recovery-wake'

/** Endings read and classified at once. */
export const IDLE_RECOVERY_SWEEP_CONCURRENCY = 3
/** A chat not idle for this long loses its row (and with it its wake count). */
export const IDLE_RECOVERY_FORGET_AFTER_MS = 7 * 24 * 60 * 60 * 1000
/** `seenAt` moves in steps this long, so a quiet sweep leaves the state as it was. */
const SEEN_STEP_MS = 60 * 60 * 1000
/** Sent when the classifier called an ending stalled without naming the work. */
export const IDLE_RECOVERY_DEFAULT_NEXT_STEP =
  'Your last turn ended with work you offered or planned but did not start. Do it now.'

export type IdleRecoverySweepDeps = {
  listCandidates: typeof listIdleRecoveryCandidates
  readEnding: typeof readIdleRecoveryEnding
  classify: typeof classifyIdleRecoveryEnding
  /** Resolves true when the chat took the wake. */
  sendWake: (candidate: IdleRecoveryCandidate, nextStep: string) => Promise<boolean>
  concurrency: number
}

export type IdleRecoverySweepInput = {
  settings: IdleRecoverySettings
  nowMs: number
  state: IdleRecoveryPersistedState
  /** Tests replace the readers, the classifier and the send. */
  deps?: Partial<IdleRecoverySweepDeps>
  signal?: AbortSignal
}

type Look = {
  candidate: IdleRecoveryCandidate
  fingerprint: string
  /** Null when the ending needed no (new) verdict. */
  verdict: IdleRecoveryVerdict | null
  wakes: number
}

async function pooled<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length })
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await work(items[index])
    }
  }
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  await Promise.all(Array.from({ length: workers }, worker))
  return results
}

function due(row: IdleRecoveryStoredChat, nowMs: number): boolean {
  return row.wakeAt !== null && row.wakeAt <= nowMs
}

function inboxItem(chatId: string, row: IdleRecoveryStoredChat): ForkIdleRecoveryInboxItem {
  return {
    chatId,
    kind: row.kind,
    agent: row.agent,
    title: row.title,
    workspace: row.workspace,
    worktreeId: row.worktreeId,
    verdict: 'waiting_user',
    question: row.question,
    reason: row.reason,
    since: row.since,
    wakes: row.wakes,
    wakeAt: null,
    paused: row.paused
  }
}

export async function runIdleRecoverySweep(
  input: IdleRecoverySweepInput
): Promise<IdleRecoverySweepResult> {
  const { settings, nowMs } = input
  if (settings.mode === 'off') {
    return { changed: false, newlyWaiting: [] }
  }
  const deps: IdleRecoverySweepDeps = {
    listCandidates: listIdleRecoveryCandidates,
    readEnding: readIdleRecoveryEnding,
    classify: classifyIdleRecoveryEnding,
    sendWake: sendIdleRecoveryWake,
    concurrency: IDLE_RECOVERY_SWEEP_CONCURRENCY,
    ...input.deps
  }
  const { chats } = asIdleRecoveryStoredState(input.state)
  const before = JSON.stringify(listIdleRecoveryInboxItems({ version: 1, chats }))
  const paused = new Set(settings.paused)
  const seen = new Map<string, IdleRecoveryCandidate>()
  const toRead: IdleRecoveryCandidate[] = []
  /** Stalled chats whose ending is known: only the wake rules are asked again. */
  const stalled: IdleRecoveryCandidate[] = []

  for (const candidate of await deps.listCandidates(settings, nowMs)) {
    const { chatId } = candidate
    if (seen.has(chatId)) {
      continue
    }
    seen.set(chatId, candidate)
    const row = chats[chatId] as IdleRecoveryStoredChat | undefined
    if (row) {
      row.listed = true
      row.paused = paused.has(chatId)
      row.title = candidate.title
      row.workspace = candidate.workspace
      row.worktreeId = candidate.worktreeId
      if (nowMs - row.seenAt >= SEEN_STEP_MS) {
        row.seenAt = nowMs
      }
    }
    if (paused.has(chatId)) {
      continue
    }
    if (!row || row.idleSince !== candidate.idleSince) {
      toRead.push(candidate)
    } else if (row.verdict === 'stalled') {
      stalled.push(candidate)
    } else if (due(row, nowMs)) {
      toRead.push(candidate)
    }
  }

  const looks = await pooled(toRead, deps.concurrency, async (candidate): Promise<Look | null> => {
    try {
      const ending = await deps.readEnding(candidate)
      if (!ending) {
        return null
      }
      const tail = tailForIdleRecoveryClassifier(ending.lastAssistantMessage)
      const request = ending.lastUserRequest
      const fingerprint = idleRecoveryEndingFingerprint(
        candidate.chatId,
        `${request.length}:${request}${tail}`
      )
      const row = chats[candidate.chatId] as IdleRecoveryStoredChat | undefined
      const sameEnding = row?.fingerprint === fingerprint
      if (row && sameEnding && (row.verdict === 'stalled' || !due(row, nowMs))) {
        return { candidate, fingerprint, verdict: null, wakes: row.wakes }
      }
      // A turn the user started gives the chat its wakes back.
      const carried =
        sameEnding || candidate.requestSource === 'wake' || isWakePrompt(candidate.lastPrompt)
      const wakes = row && carried ? row.wakes : 0
      const verdict = await deps.classify(
        {
          version: IDLE_RECOVERY_INPUT_VERSION,
          chat: {
            id: candidate.chatId,
            kind: candidate.kind,
            agent: candidate.agent,
            cwd: candidate.cwd,
            title: candidate.title
          },
          request_source: candidate.requestSource,
          role: candidate.role,
          last_user_request: request,
          last_assistant_message: tail,
          idle_seconds: Math.max(0, Math.floor((nowMs - candidate.idleSince) / 1000)),
          background_pending: candidate.backgroundPending,
          scheduled_wake: candidate.scheduledWake,
          wakes_this_turn: wakes,
          max_wakes: settings.maxWakes
        },
        settings,
        input.signal
      )
      return { candidate, fingerprint, verdict, wakes }
    } catch (error) {
      // Left as it was: the next sweep looks again.
      console.warn('[fork idle recovery] could not read or classify an ending', error)
      return null
    }
  })

  const newlyWaiting: ForkIdleRecoveryInboxItem[] = []
  const recheckMaxSeconds = settings.recheckMaxMinutes * 60
  for (const look of looks) {
    if (!look) {
      continue
    }
    const { candidate, fingerprint, verdict } = look
    const { chatId } = candidate
    const previous = chats[chatId] as IdleRecoveryStoredChat | undefined
    if (!verdict) {
      if (previous) {
        previous.idleSince = candidate.idleSince
        if (previous.verdict === 'stalled') {
          stalled.push(candidate)
        }
      }
      continue
    }
    const sameEnding = previous?.fingerprint === fingerprint
    const waitSeconds = Math.min(recheckMaxSeconds, Math.max(0, verdict.wakeAfterSeconds))
    const later = waitSeconds > 0 ? nowMs + waitSeconds * 1000 : null
    const row: IdleRecoveryStoredChat = {
      fingerprint,
      verdict: verdict.verdict,
      question: verdict.verdict === 'waiting_user' ? verdict.question : '',
      since: previous && sameEnding ? previous.since : nowMs,
      wakes: look.wakes,
      // A stalled chat is woken now or after the wait; any other verdict is looked at again.
      wakeAt: verdict.verdict === 'stalled' ? (later ?? nowMs) : later,
      paused: false,
      reason: verdict.reason,
      nextStep: verdict.verdict === 'stalled' ? verdict.nextStep : '',
      idleSince: candidate.idleSince,
      seenAt: nowMs,
      listed: true,
      kind: candidate.kind,
      agent: candidate.agent,
      title: candidate.title,
      workspace: candidate.workspace,
      worktreeId: candidate.worktreeId
    }
    chats[chatId] = row
    if (row.verdict === 'stalled') {
      stalled.push(candidate)
    } else if (
      row.verdict === 'waiting_user' &&
      !(previous && sameEnding && previous.verdict === 'waiting_user')
    ) {
      newlyWaiting.push(inboxItem(chatId, row))
    }
  }

  // One at a time, in candidate order: a wake is a send into a live chat.
  for (const candidate of stalled) {
    const row = chats[candidate.chatId] as IdleRecoveryStoredChat | undefined
    if (!row || row.verdict !== 'stalled') {
      continue
    }
    const decision =
      settings.mode === 'wake'
        ? decideIdleRecoveryWake({
            wakesThisTurn: row.wakes,
            maxWakes: settings.maxWakes,
            requestSource: candidate.requestSource,
            role: candidate.role,
            workers: settings.workers,
            paused: false,
            backgroundPending: candidate.backgroundPending,
            scheduledWake: candidate.scheduledWake,
            coordinatorBusy: candidate.coordinatorBusy
          })
        : null
    if (!decision || decision.action === 'never') {
      // Stays in the inbox as stalled, with no wake to come.
      row.wakeAt = null
      continue
    }
    row.wakeAt ??= nowMs
    if (decision.action === 'hold' || row.wakeAt > nowMs) {
      continue
    }
    let taken = false
    try {
      taken = await deps.sendWake(candidate, row.nextStep.trim() || IDLE_RECOVERY_DEFAULT_NEXT_STEP)
    } catch (error) {
      console.warn('[fork idle recovery] wake failed', error)
    }
    if (taken) {
      row.wakes += 1
      // The ending was acted on: off the inbox until the woken turn ends and is read.
      row.verdict = 'finished'
      row.wakeAt = null
    } else {
      // Nothing was sent (a draft, a dialog, a busy or sleeping chat): ask again later.
      row.wakeAt = nowMs + settings.idleSeconds * 1000
    }
  }

  for (const [chatId, row] of Object.entries(chats)) {
    if (seen.has(chatId)) {
      continue
    }
    if (paused.has(chatId)) {
      // The candidate list leaves a paused chat out: its item stays as it was, marked paused.
      row.paused = true
      continue
    }
    row.paused = false
    // In a turn, closed or asleep: off the inbox, the wake count kept for when it idles again.
    row.listed = false
    if (nowMs - row.seenAt > IDLE_RECOVERY_FORGET_AFTER_MS) {
      delete chats[chatId]
    }
  }

  const after = JSON.stringify(listIdleRecoveryInboxItems({ version: 1, chats }))
  return { changed: before !== after, newlyWaiting }
}
