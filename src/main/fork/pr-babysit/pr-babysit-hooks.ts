// PR babysitter (FORK.md, SLRM-2386): the live service and the hooks upstream files call.
// - `installForkPrBabysit(store)`: from `installForkReady` (desktop) and `installForkHeadlessHost`
//   (orcad), so workers on a headless server are babysat by the server they run on.
// The PR watcher's own hooks are in `pr-babysit-slot.ts`, which loads no fork code.
// Nothing here starts work while no pull request is babysat: a line for a PR that is neither on
// the Settings repo list nor named by `orca babysit` is dropped after one state lookup.
import { prKeyOf } from '../../github/pr-watch/pr-watch-types'
import { addPRRefreshOutcomeObserver } from '../../github/pull-requests/refresh/pr-refresh-coordinator'
import { readIdleRecoverySettings } from '../../../shared/fork/idle-recovery-settings'
import { readPrBabysitSettings } from '../../../shared/fork/pr-babysit'
import type {
  ForkPrBabysitChangeResult,
  ForkPrBabysitListResult
} from '../../../shared/fork/pr-babysit-wire'
import { idleRecoveryChatPort } from '../idle-recovery/idle-recovery-ports'
import { notifyIdleRecoveryWaiting } from '../idle-recovery/idle-recovery-notify'
import {
  notifyForkInboxSourceChanged,
  registerForkInboxSource
} from '../idle-recovery/idle-recovery-sources'
import { sendIdleRecoveryAnswer } from '../idle-recovery/idle-recovery-wake'
import { startForkBackoffTimer } from '../fork-backoff-timer'
import { livePrBabysitGitHub } from './pr-babysit-github'
import { createPrBabysitService, type PrBabysitService } from './pr-babysit-service'
import { loadPrBabysitState, savePrBabysitState } from './pr-babysit-state'
import { forkPrBabysitChatWorkspace, setForkPrBabysitLineHandler } from './pr-babysit-slot'

const SWEEP_MS = 60_000
/** With no fix request waiting the wait check backs off to this. */
const SWEEP_IDLE_MS = 10 * 60_000

let readSettings: () => unknown = () => null
let service: PrBabysitService | null = null
let stopInstalled: (() => void) | null = null

function liveService(): PrBabysitService {
  service ??= createPrBabysitService({
    now: Date.now,
    settings: () => readPrBabysitSettings(readSettings() as never),
    load: () => loadPrBabysitState(),
    save: (state) => savePrBabysitState(state),
    github: livePrBabysitGitHub,
    workspace: forkPrBabysitChatWorkspace,
    chat: idleRecoveryChatPort(),
    answer: (chatId, text) => sendIdleRecoveryAnswer(chatId, text, { kind: 'chat', agent: '' }),
    notify: (items) =>
      notifyIdleRecoveryWaiting(items, readIdleRecoverySettings(readSettings() as never)),
    changed: notifyForkInboxSourceChanged,
    warn: (message, error) => console.warn(message, error)
  })
  return service
}

/** Idempotent; a second call swaps the settings reader. Returns what to run at shutdown. */
export function installForkPrBabysit(store: { getSettings: () => unknown }): () => void {
  readSettings = () => store.getSettings()
  if (stopInstalled) {
    return stopInstalled
  }
  const live = liveService()
  const removeSource = registerForkInboxSource({
    id: 'babysit',
    items: () => live.inboxItems(),
    answer: (chatId, text) => live.answer(chatId, text),
    dismiss: (chatId) => live.dismiss(chatId)
  })
  // Stock PR reads (sidebar refresh, CI-line watches) let a merge held by a review go once allowed.
  const stopObserving = addPRRefreshOutcomeObserver((_candidate, outcome) => {
    const key = outcome.kind === 'found' ? prKeyOf(outcome.pr) : null
    if (outcome.kind === 'found' && key && outcome.pr.headSha && outcome.pr.state === 'open') {
      void live.observed(key, outcome.pr.headSha)
    }
  })
  setForkPrBabysitLineHandler((chatId, delivery) => void live.line(chatId, delivery))
  const stopTimer = startForkBackoffTimer({
    run: () => live.sweep(),
    baseMs: SWEEP_MS,
    maxMs: SWEEP_IDLE_MS,
    onError: (error) => console.warn('[fork pr babysit] wait check failed', error)
  })
  stopInstalled = () => {
    stopTimer()
    setForkPrBabysitLineHandler(null)
    stopObserving()
    removeSource()
    stopInstalled = null
  }
  return stopInstalled
}

export function listForkPrBabysit(): Promise<ForkPrBabysitListResult> {
  return liveService().list()
}

export function startForkPrBabysit(pr: string): Promise<ForkPrBabysitChangeResult> {
  return liveService().start(pr)
}

export function stopForkPrBabysit(pr: string): Promise<ForkPrBabysitChangeResult> {
  return liveService().stop(pr)
}
