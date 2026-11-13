// Sleepers (FORK.md): list this host's chat and terminal agents with their sleep state, sleep
// idle chats now through the stock idle sweep, and pin chats awake. The desktop dialog and
// `orca sleepers` both call these; each host answers for its own chats.
import { defineMethod, type RpcContext } from '../../core'
import {
  buildSleeperRows,
  readForkSleepersPinned,
  selectSleepAllIdle,
  selectSleepExceptVisible,
  withForkSleeperPinned
} from '../../../../../shared/fork/sleepers'
import { sleeperSourcesFromPs } from '../../../../../shared/fork/sleepers-ps-sources'
import {
  ForkSleepersListParams,
  ForkSleepersPinParams,
  ForkSleepersSleepParams,
  type ForkSleepersListResult,
  type ForkSleepersPinResult,
  type ForkSleepersSleepResult
} from '../../../../../shared/fork/sleepers-wire'
import { isForkChatOnScreen } from '../../../../fork/chat-sleep/chat-sleep-sweep'
import {
  forkSleeperChatFacts,
  forkSleepersServiceDeps
} from '../../../../fork/sleepers/sleepers-host'
import { sleepChatsNow } from '../../../../fork/sleepers/sleepers-service'
import { ensureStructuredHostInstalled } from '../structured-sessions/creation/structured-agent-session-gate'

async function listSleepers(ctx: RpcContext): Promise<ForkSleepersListResult> {
  await ensureStructuredHostInstalled(ctx)
  const ps = await ctx.runtime.getWorktreePs()
  const sources = sleeperSourcesFromPs(ps.worktrees, forkSleeperChatFacts())
  const now = Date.now()
  // Main hears which chats are on screen only while chat sleep is on; the dialog fills the rest.
  const onScreen = new Set(sources.filter((s) => isForkChatOnScreen(s.id)).map((s) => s.id))
  const pinned = new Set(readForkSleepersPinned(ctx.runtime.requireStore().getSettings()))
  return { now, rows: buildSleeperRows(sources, { now, pinned, onScreen }) }
}

export const FORK_SLEEPERS_METHODS = [
  defineMethod({
    name: 'fork.sleepers.list',
    permission: 'workspace',
    params: ForkSleepersListParams,
    handler: async (_params, ctx) => listSleepers(ctx)
  }),
  defineMethod({
    name: 'fork.sleepers.sleep',
    permission: 'workspace',
    params: ForkSleepersSleepParams,
    handler: async (params, ctx): Promise<ForkSleepersSleepResult> => {
      await ensureStructuredHostInstalled(ctx)
      let ids = params.sessionIds ?? []
      if (params.allIdle) {
        const { rows } = await listSleepers(ctx)
        const picked = params.exceptVisible
          ? selectSleepExceptVisible(rows)
          : selectSleepAllIdle(rows)
        ids = [...new Set([...ids, ...picked.map((row) => row.id)])]
      }
      return { outcomes: await sleepChatsNow(forkSleepersServiceDeps(), ids) }
    }
  }),
  defineMethod({
    name: 'fork.sleepers.pin',
    permission: 'workspace',
    params: ForkSleepersPinParams,
    handler: async (params, ctx): Promise<ForkSleepersPinResult> => {
      const store = ctx.runtime.requireStore()
      if (!store.updateSettings) {
        throw new Error('This host cannot save settings, so it cannot pin chats.')
      }
      const update = withForkSleeperPinned(store.getSettings(), params.sessionId, params.pinned)
      store.updateSettings(update, { notifyListeners: true })
      return {
        sessionId: params.sessionId,
        pinned: params.pinned,
        pinnedCount: update.forkSleepersPinned?.length ?? 0
      }
    }
  })
] as const
