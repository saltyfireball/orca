// SLRM-1503: renderer hooks that name the Claude account of a pane, tab, chat, agent row or worktree.
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAppStore, type AppState } from '@/store'
import type { ClaudeManagedAccount } from '../../../../shared/managed-account-types'
import { NO_ACCOUNT, type ForkClaudeAccountResolution } from './claude-account-identity'
import {
  agentRowEvidence,
  chatEvidence,
  paneEvidence,
  terminalTabEvidence,
  worktreeEvidence,
  type ClaudeChipEvidence
} from './claude-chip-evidence'
import {
  getChatHome,
  getClaudeChipCacheVersion,
  getClaudeHostSnapshot,
  loadChatHome,
  loadClaudeHost,
  subscribeClaudeChipCache
} from './claude-chip-host-cache'
import { resolveAllEvidence } from './claude-chip-resolve'

const NO_SAVED: ClaudeManagedAccount[] = []
let lastLocalRoster: readonly ClaudeManagedAccount[] | null = null

/** Whether chips show at all (Settings > Advanced); unset is on. */
export function isForkAccountChipEnabled(state: Pick<AppState, 'settings'>): boolean {
  return state.settings?.forkShowAccountChip !== false
}

function parseEvidence(key: string): ClaudeChipEvidence[] {
  const parsed: ClaudeChipEvidence[] = key ? JSON.parse(key) : []
  return parsed
}

/**
 * The account behind whatever `select` finds in the store. The selector returns plain data, so
 * it is compared as text and a store write that changes nothing about the sessions re-renders nothing.
 */
export function useClaudeAccountResolution(
  select: (state: AppState) => readonly ClaudeChipEvidence[]
): ForkClaudeAccountResolution {
  const evidenceKey = useAppStore((state) => {
    if (!isForkAccountChipEnabled(state)) {
      return ''
    }
    const evidence = select(state)
    return evidence.length > 0 ? JSON.stringify(evidence) : ''
  })
  const saved = useAppStore((state) => state.settings?.claudeManagedAccounts ?? NO_SAVED)
  useSyncExternalStore(subscribeClaudeChipCache, getClaudeChipCacheVersion)
  const evidence = useMemo(() => parseEvidence(evidenceKey), [evidenceKey])
  useEffect(() => {
    for (const entry of evidence) {
      if (!entry.wslHostDistro) {
        void loadClaudeHost(entry.ownerTarget)
      }
      if (entry.chatSessionId !== undefined) {
        void loadChatHome(entry.transport, entry.chatSessionId)
      }
    }
  }, [evidence])
  // A saved account added or removed changes which folders the host reports.
  const onLocalHost = evidence.some(
    (entry) => entry.ownerTarget.kind === 'local' && !entry.wslHostDistro
  )
  useEffect(() => {
    // Shared by every chip, so one roster change is one read, not one per chip.
    if (onLocalHost && saved !== lastLocalRoster) {
      const changed = lastLocalRoster !== null
      lastLocalRoster = saved
      void loadClaudeHost({ kind: 'local' }, changed)
    }
  }, [saved, onLocalHost])
  // Cheap and pure; the cache version subscription above rerenders when a host or chat answers.
  return evidence.length === 0
    ? NO_ACCOUNT
    : resolveAllEvidence(evidence, saved, {
        host: getClaudeHostSnapshot,
        chatHome: getChatHome
      })
}

function list(evidence: ClaudeChipEvidence | null): ClaudeChipEvidence[] {
  return evidence ? [evidence] : []
}

/** One terminal pane. */
export function useClaudeAccountForPane(
  worktreeId: string,
  tabId: string,
  paneKey: string
): ForkClaudeAccountResolution {
  return useClaudeAccountResolution((state) =>
    list(paneEvidence(state, worktreeId, tabId, paneKey))
  )
}

/** A terminal tab (all its split panes) or, given `chatSessionId`, a native chat tab. */
export function useClaudeAccountForTab(ref: {
  worktreeId: string
  tabId: string
  unifiedTabId?: string
  chatSessionId?: string
}): ForkClaudeAccountResolution {
  const { worktreeId, tabId, unifiedTabId, chatSessionId } = ref
  return useClaudeAccountResolution((state) =>
    chatSessionId !== undefined
      ? list(chatEvidence(state, worktreeId, chatSessionId, unifiedTabId))
      : terminalTabEvidence(state, worktreeId, tabId)
  )
}

/** An agent row: a terminal pane or a native chat's status row. */
export function useClaudeAccountForAgentRow(
  worktreeId: string,
  tabId: string,
  paneKey: string
): ForkClaudeAccountResolution {
  return useClaudeAccountResolution((state) =>
    list(agentRowEvidence(state, worktreeId, tabId, paneKey))
  )
}

/** Every Claude session in a worktree; `mixed` when they are on different accounts or hosts. */
export function useClaudeAccountForWorktree(worktreeId: string): ForkClaudeAccountResolution {
  return useClaudeAccountResolution((state) => worktreeEvidence(state, worktreeId))
}
