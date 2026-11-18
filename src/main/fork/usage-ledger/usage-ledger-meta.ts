// SLRM-2103 (FORK.md "Usage ledger and cache-cold cue"): the names the ledger keeps per chat, read
// from the chat host and the settings store. Kept apart from the window's side so a headless
// server can run the ledger too (SLRM-2385). Keep electron out of this file.
import { basename } from 'node:path'
import { splitWorktreeId } from '../../../shared/worktree/id'
import type { ForkUsageLedgerSettings } from '../../../shared/fork/usage-ledger'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { Store } from '../../persistence/loading-store/store'
import { forkAgentQueueWorkerParent } from '../agent-queue/agent-queue-service'
import type { UsageChatMeta } from './usage-ledger'

export type UsageLedgerStoreReader = {
  getSettings: () => ForkUsageLedgerSettings | undefined
  workspaceName: (workspaceId: string) => string | undefined
}

/** The two things the ledger reads from the app's store, or undefined before it loads. */
export function forkUsageLedgerStoreReader(
  store: Pick<Store, 'getSettings' | 'getWorktreeMeta'> | null | undefined
): UsageLedgerStoreReader | undefined {
  return store
    ? {
        getSettings: () => store.getSettings(),
        workspaceName: (workspaceId) => store.getWorktreeMeta(workspaceId)?.displayName
      }
    : undefined
}

const TITLE_CHARS = 80

export function forkUsageChatMeta(
  sessionId: string,
  store: UsageLedgerStoreReader
): UsageChatMeta | undefined {
  const summary = getStructuredAgentSessionHost()?.readStatusSummary(sessionId)
  const parentSessionId = forkAgentQueueWorkerParent(sessionId)
  if (!summary) {
    return parentSessionId ? { parentSessionId } : undefined
  }
  const text = (summary.conversationName?.trim() || summary.latestPrompt || '')
    .replace(/\s+/g, ' ')
    .trim()
  const title = text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 3)}...` : text
  const workspaceId = summary.workspaceId || undefined
  const path = workspaceId ? splitWorktreeId(workspaceId)?.worktreePath : undefined
  const workspaceName =
    (workspaceId ? store.workspaceName(workspaceId)?.trim() : undefined) ||
    (path ? basename(path) : undefined)
  return {
    agent: summary.agent,
    ...(title ? { title } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(workspaceName ? { workspaceName } : {}),
    ...(parentSessionId ? { parentSessionId } : {})
  }
}
