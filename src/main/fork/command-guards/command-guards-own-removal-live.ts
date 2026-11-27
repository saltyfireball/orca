// Command guards (FORK.md, BAD-892): a bot's own worktree removal wired to the running host. The
// host seam is read from the runtime the guards start with; without it the removal stays blocked.
import type { CommandGuardAuditEntry } from '../../../shared/fork/command-guards'
import type { OwnWorktreeRemovalRequest } from '../../../shared/fork/command-guards-rules'
import type { BotChatTreeIndex } from '../../bots/bot-chat-tree-index'
import {
  judgeOwnWorktreeRemoval,
  type OwnRemovalCaller,
  type OwnRemovalHost,
  type OwnRemovalPsRow
} from './command-guards-own-removal'

/** What a bot's own removal reads; the runtime has all three, and a bare store has none. */
export type OwnRemovalRuntimeSeam = {
  showManagedWorktree?: (selector: string) => Promise<{
    id: string
    path: string
    branch: string
    isMainWorktree: boolean
  }>
  getWorktreePs?: (
    limit?: number,
    sourceDefaultsSupported?: boolean,
    includeAgentWait?: boolean,
    worktreeId?: string
  ) => Promise<{ worktrees: readonly OwnRemovalPsRow[] }>
  botChatTreeIndex?: Pick<BotChatTreeIndex, 'botOfPane' | 'botOfSession' | 'botOfWorktree'> | null
}

type SeamOwner = OwnRemovalRuntimeSeam & {
  requireStore: () => { getBots?: () => readonly { id: string; name: string }[] }
}

const PS_LIMIT = 10_000

function ownRemovalHost(live: SeamOwner): OwnRemovalHost | null {
  const show = live.showManagedWorktree?.bind(live)
  const ps = live.getWorktreePs?.bind(live)
  const store = live.requireStore()
  if (!show || !ps || !store.getBots) {
    return null
  }
  const getBots = store.getBots.bind(store)
  return {
    bots: () => getBots(),
    botIdOfPane: (paneKey) => live.botChatTreeIndex?.botOfPane(paneKey) ?? null,
    botIdOfSession: (sessionId) => live.botChatTreeIndex?.botOfSession(sessionId) ?? null,
    botIdOfWorktree: (worktreeId) => live.botChatTreeIndex?.botOfWorktree(worktreeId) ?? null,
    resolveWorktree: show,
    psRows: async (worktreeId) => (await ps(PS_LIMIT, true, false, worktreeId)).worktrees
  }
}

export type OwnRemovalAnswer =
  /** Allowed: the audit entry to record. */
  | { allowed: true; audit: Pick<CommandGuardAuditEntry, 'reason' | 'outcome' | 'removal'> }
  /** Refused: the failed condition, to add to the refusal text. */
  | { allowed: false; why: string }
  /** The host cannot judge it: refuse as the rule always did. */
  | null

export async function answerOwnRemoval(
  live: SeamOwner | null,
  caller: OwnRemovalCaller,
  request: OwnWorktreeRemovalRequest,
  protectedBranches: readonly string[]
): Promise<OwnRemovalAnswer> {
  const host = live ? ownRemovalHost(live) : null
  if (!host) {
    return null
  }
  const { decision, workspace, branchDeleted } = await judgeOwnWorktreeRemoval(
    host,
    caller,
    request,
    protectedBranches
  )
  return decision.allowed
    ? {
        allowed: true,
        audit: {
          reason: decision.reason,
          outcome: 'allowed',
          removal: {
            bot: decision.bot,
            workspace: workspace?.id ?? '',
            branch: workspace?.branch ?? '',
            branchDeleted
          }
        }
      }
    : {
        allowed: false,
        why: `Not allowed for a bot's own workspace (${decision.failed}): ${decision.reason}`
      }
}
