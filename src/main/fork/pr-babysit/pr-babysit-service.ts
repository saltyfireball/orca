// PR babysitter (FORK.md, SLRM-2386): the host service's commands over its core
// (`pr-babysit-core.ts`): CI lines, the stock PR reads, the wait check, `orca babysit` and the
// Decision inbox rows. Keep electron out of this file: it also runs in the headless server.
import type {
  ForkIdleRecoveryAnswerOutcome,
  ForkIdleRecoveryInboxItem
} from '../../../shared/fork/idle-recovery-wire'
import {
  parsePrBabysitTarget,
  prBabysitKey,
  prBabysitOverdue,
  prBabysitRepoListed,
  type PrBabysitLine
} from '../../../shared/fork/pr-babysit'
import type {
  ForkPrBabysitChangeResult,
  ForkPrBabysitListResult
} from '../../../shared/fork/pr-babysit-wire'
import {
  createPrBabysitCore,
  newPrBabysitEntry,
  prBabysitInboxItem,
  type PrBabysitServiceDeps
} from './pr-babysit-core'

export type { PrBabysitServiceDeps } from './pr-babysit-core'
export { prBabysitInboxItem } from './pr-babysit-core'

/** A blocked merge is tried again on a stock PR read at most this often. */
const MERGE_RETRY_MS = 5 * 60_000

export function createPrBabysitService(deps: PrBabysitServiceDeps) {
  const core = createPrBabysitCore(deps)
  const { loaded, serial, commit, stick, tryMerge, handleLine } = core
  const loading = core.isLoaded
  return {
    /** A CI line was appended to `chatId`. Never throws; runs after earlier steps of that PR. */
    line(chatId: string, line: PrBabysitLine): Promise<void> {
      const prKey = line.prKey.toLowerCase()
      return serial(prKey, () => handleLine(chatId, { ...line, prKey }))
    },

    /** A stock PR read saw `headSha` on this PR: a blocked merge may be tried again. */
    observed(prKey: string, headSha: string): Promise<void> {
      const key = prKey.toLowerCase()
      if (!loading() || !deps.settings().autoMerge) {
        return Promise.resolve()
      }
      return serial(key, async () => {
        const state = await loaded()
        const entry = state.entries[key]
        const last = core.mergeTriedAt(key)
        if (
          entry?.phase !== 'green' ||
          entry.reason !== 'merge-blocked' ||
          entry.headSha !== headSha.toLowerCase() ||
          deps.now() - last < MERGE_RETRY_MS
        ) {
          return
        }
        await tryMerge(entry, headSha)
        entry.updatedAt = deps.now()
        await commit(state)
      })
    },

    /** Fix requests with no CI result for too long stop and ask you. */
    /** Resolves true while a fix request waits for CI, so the backing-off timer stays close. */
    async sweep(): Promise<boolean> {
      if (!loading()) {
        return false
      }
      const state = await loaded()
      const settings = deps.settings()
      for (const entry of Object.values(state.entries)) {
        if (prBabysitOverdue(entry, deps.now(), settings)) {
          await serial(entry.prKey, async () => {
            if (prBabysitOverdue(entry, deps.now(), settings)) {
              await stick(entry, 'no-ci')
              entry.updatedAt = deps.now()
              await commit(state)
            }
          })
        }
      }
      return Object.values(state.entries).some((entry) => entry.phase === 'fixing')
    },

    async list(): Promise<ForkPrBabysitListResult> {
      const settings = deps.settings()
      const state = await loaded()
      return {
        now: deps.now(),
        reposOn: settings.repos.length > 0,
        autoMerge: settings.autoMerge,
        maxRounds: settings.maxRounds,
        entries: Object.values(state.entries).sort((a, b) => b.updatedAt - a.updatedAt)
      }
    },

    async start(target: string): Promise<ForkPrBabysitChangeResult> {
      const pr = parsePrBabysitTarget(target)
      if (!pr) {
        return { prKey: null, result: 'invalid', entry: null }
      }
      const prKey = prBabysitKey(pr)
      let result: ForkPrBabysitChangeResult = { prKey, result: 'started', entry: null }
      await serial(prKey, async () => {
        const state = await loaded()
        const entry = state.entries[prKey] ?? newPrBabysitEntry(prKey, 'cli', deps.now())
        state.entries[prKey] = entry
        entry.source = 'cli'
        entry.rounds = 0
        entry.stuckSince = null
        entry.fixSentAt = null
        if (entry.phase === 'green' && entry.reason === 'merge-blocked' && entry.headSha) {
          if (deps.settings().autoMerge) {
            await tryMerge(entry, entry.headSha)
          }
        } else if (entry.phase !== 'green' && entry.phase !== 'merged') {
          entry.phase = 'watching'
          entry.reason = null
          entry.detail = ''
        }
        entry.updatedAt = deps.now()
        await commit(state)
        result = { prKey, result: 'started', entry: { ...entry } }
      })
      return result
    },

    async stop(target: string): Promise<ForkPrBabysitChangeResult> {
      const pr = parsePrBabysitTarget(target)
      if (!pr) {
        return { prKey: null, result: 'invalid', entry: null }
      }
      const prKey = prBabysitKey(pr)
      let result: ForkPrBabysitChangeResult = { prKey, result: 'not-babysat', entry: null }
      await serial(prKey, async () => {
        const state = await loaded()
        let entry = state.entries[prKey]
        const listed = prBabysitRepoListed(prKey, deps.settings().repos)
        if (!entry && listed) {
          // An override of the repo list for this one pull request.
          entry = newPrBabysitEntry(prKey, 'repo', deps.now())
          state.entries[prKey] = entry
        }
        if (!entry || entry.phase === 'stopped') {
          return
        }
        entry.phase = 'stopped'
        entry.reason = null
        entry.detail = ''
        entry.fixSentAt = null
        entry.updatedAt = deps.now()
        await commit(state)
        result = { prKey, result: 'stopped', entry: { ...entry } }
      })
      return result
    },

    /** Stuck pull requests, as Decision inbox rows. */
    async inboxItems(): Promise<ForkIdleRecoveryInboxItem[]> {
      const state = await loaded()
      return Object.values(state.entries).flatMap((entry) => prBabysitInboxItem(entry) ?? [])
    },

    /** Your answer to a stuck pull request's chat; it is babysat again with fresh rounds. */
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
          entry.phase = 'watching'
          entry.rounds = 0
          entry.reason = null
          entry.detail = ''
          entry.stuckSince = null
          entry.updatedAt = deps.now()
          await commit(state)
        })
      }
      return outcome
    },

    /** The inbox row's Stop: babysitting ends for that chat's stuck pull requests. */
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

export type PrBabysitService = ReturnType<typeof createPrBabysitService>
