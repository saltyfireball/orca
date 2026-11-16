// Snooze (FORK.md, SLRM-2269): `orca snooze`. List, snooze and wake; none of these runs the settle
// cleanup command (only the desktop window's settle call does) and none takes a command.
import { defineMethod, type RpcContext } from '../../core'
import {
  forkSnoozeHostId,
  parseForkSnoozeUntil,
  readForkSnoozeSettings,
  type ForkSnoozeTarget
} from '../../../../../shared/fork/snooze'
import {
  ForkSnoozeListParams,
  ForkSnoozeSetParams,
  ForkSnoozeWakeParams,
  type ForkSnoozeListResult,
  type ForkSnoozeSetResult,
  type ForkSnoozeWakeResult
} from '../../../../../shared/fork/snooze-wire'
import { LOCAL_EXECUTION_HOST_ID, parseExecutionHostId } from '../../../../../shared/execution-host'
import { sleeperSourcesFromPs } from '../../../../../shared/fork/sleepers-ps-sources'
import { forkSleeperChatFacts } from '../../../../fork/sleepers/sleepers-host'
import { forkSnoozeStore } from '../../../../fork/snooze/snooze-store'
import { getCanonicalUserDataPath } from '../../../../persistence/loading-store/user-data-path'
import { ensureStructuredHostInstalled } from '../structured-sessions/creation/structured-agent-session-gate'

const store = () => forkSnoozeStore(getCanonicalUserDataPath())

type Resolved = { target: ForkSnoozeTarget; label: string }

/** chat:<id>: a chat's session id or unique prefix, or a terminal agent's pane key. */
async function resolveChat(ctx: RpcContext, query: string): Promise<Resolved> {
  await ensureStructuredHostInstalled(ctx)
  const ps = await ctx.runtime.getWorktreePs()
  const sources = sleeperSourcesFromPs(ps.worktrees, forkSleeperChatFacts())
  const exact = sources.filter((source) => source.id === query || source.paneKey === query)
  const matches =
    exact.length > 0
      ? exact
      : query.length >= 4
        ? sources.filter((source) => source.id.startsWith(query))
        : []
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `No chat matches "${query}". Run "orca sleepers list" for chat ids.`
        : `"${query}" matches more than one chat; use more of its id.`
    )
  }
  const source = matches[0]
  return {
    target: {
      kind: 'chat',
      paneKey: source.paneKey,
      worktreeId: source.worktreeId,
      hostId: LOCAL_EXECUTION_HOST_ID,
      ...(source.kind === 'chat' ? { sessionId: source.id } : {})
    },
    label: source.title || source.workspace || source.id
  }
}

async function resolveTarget(
  ctx: RpcContext,
  selector: string,
  host: string | undefined
): Promise<Resolved> {
  if (selector.startsWith('chat:')) {
    return resolveChat(ctx, selector.slice('chat:'.length).trim())
  }
  const hostId = forkSnoozeHostId(host)
  if (hostId !== LOCAL_EXECUTION_HOST_ID) {
    // This Orca does not hold a paired server's workspaces; keep the id as the sidebar shows it.
    if (parseExecutionHostId(hostId)?.kind !== 'runtime') {
      throw new Error('--host takes runtime:<environment-id> for a paired server.')
    }
    const worktreeId = selector.startsWith('id:') ? selector.slice(3) : selector
    return { target: { kind: 'workspace', worktreeId, hostId }, label: worktreeId }
  }
  const worktree = await ctx.runtime.showManagedWorktree(selector)
  return {
    target: { kind: 'workspace', worktreeId: worktree.id, hostId: LOCAL_EXECUTION_HOST_ID },
    label: worktree.displayName || worktree.id
  }
}

export const FORK_SNOOZE_METHODS = [
  defineMethod({
    name: 'fork.snooze.list',
    permission: 'workspace',
    params: ForkSnoozeListParams,
    handler: async (): Promise<ForkSnoozeListResult> => ({
      now: Date.now(),
      entries: await store().list()
    })
  }),
  defineMethod({
    name: 'fork.snooze.set',
    permission: 'workspace',
    params: ForkSnoozeSetParams,
    handler: async (params, ctx): Promise<ForkSnoozeSetResult> => {
      const settings = readForkSnoozeSettings(ctx.runtime.requireStore().getSettings())
      if (!settings.enabled) {
        throw new Error('Snooze is off. Turn it on in Settings > Blackfish.')
      }
      const until = parseForkSnoozeUntil(params.until, Date.now(), settings)
      if (!until.ok) {
        throw new Error(until.error)
      }
      const { target, label } = await resolveTarget(ctx, params.target, params.host)
      // A paired device's snooze never starts the cleanup command when it settles.
      const paired = Boolean(ctx.pairedDeviceId) || ctx.clientKind === 'mobile'
      return { entry: await store().snooze(target, until.until, label, { noCleanup: paired }) }
    }
  }),
  defineMethod({
    name: 'fork.snooze.wake',
    permission: 'workspace',
    params: ForkSnoozeWakeParams,
    handler: async (params): Promise<ForkSnoozeWakeResult> => ({
      entry: await store().wake(params.id)
    })
  })
] as const
