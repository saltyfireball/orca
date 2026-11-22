// PR nudges (FORK.md, BAD-680): the live service. `installForkPrNudge(store)` runs from
// `installForkReady` (desktop) and `installForkHeadlessHost` (orcad), so a paired server's own PR
// watcher nudges its own chats with no desktop client open. Nothing happens while the setting is
// off: a read is dropped after one settings lookup.
import { prKeyOf } from '../../github/pr-watch/pr-watch-types'
import { addPRRefreshOutcomeObserver } from '../../github/pull-requests/refresh/pr-refresh-coordinator'
import { readIdleRecoverySettings } from '../../../shared/fork/idle-recovery-settings'
import { readPrNudgeSettings } from '../../../shared/fork/pr-nudge'
import { idleRecoveryChatPort } from '../idle-recovery/idle-recovery-ports'
import { notifyIdleRecoveryWaiting } from '../idle-recovery/idle-recovery-notify'
import {
  notifyForkInboxSourceChanged,
  registerForkInboxSource
} from '../idle-recovery/idle-recovery-sources'
import { sendIdleRecoveryAnswer } from '../idle-recovery/idle-recovery-wake'
import { forkPrBabysitChatWorkspace } from '../pr-babysit/pr-babysit-slot'
import { livePrNudgeGitHub } from './pr-nudge-github'
import { createPrNudgeService, type PrNudgeService } from './pr-nudge-service'
import { loadPrNudgeState, savePrNudgeState } from './pr-nudge-state'
import { forkPrNudgeOwner } from './pr-nudge-slot'

let readSettings: () => unknown = () => null
let service: PrNudgeService | null = null
let stopInstalled: (() => void) | null = null

function liveService(): PrNudgeService {
  service ??= createPrNudgeService({
    now: Date.now,
    settings: () => readPrNudgeSettings(readSettings() as never),
    load: () => loadPrNudgeState(),
    save: (state) => savePrNudgeState(state),
    github: livePrNudgeGitHub,
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
export function installForkPrNudge(store: { getSettings: () => unknown }): () => void {
  readSettings = () => store.getSettings()
  if (stopInstalled) {
    return stopInstalled
  }
  const live = liveService()
  const removeSource = registerForkInboxSource({
    id: 'nudge',
    items: () => live.inboxItems(),
    answer: (chatId, text) => live.answer(chatId, text),
    dismiss: (chatId) => live.dismiss(chatId)
  })
  // Stock PR reads: every read of a watched open pull request that a chat owns.
  const stopObserving = addPRRefreshOutcomeObserver((_candidate, outcome) => {
    if (outcome.kind !== 'found' || !outcome.pr.headSha || !readSettings) {
      return
    }
    const prKey = prKeyOf(outcome.pr)
    const chatId = prKey ? forkPrNudgeOwner(prKey, Date.now()) : null
    if (prKey && chatId) {
      void live.observed({
        prKey,
        chatId,
        headSha: outcome.pr.headSha,
        baseRef: outcome.pr.baseRefName ?? null,
        mergeable: outcome.pr.mergeable,
        state: outcome.pr.state
      })
    }
  })
  stopInstalled = () => {
    stopObserving()
    removeSource()
    stopInstalled = null
  }
  return stopInstalled
}
