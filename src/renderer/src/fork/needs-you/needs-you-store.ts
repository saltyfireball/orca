// Needs you (FORK.md "Needs you list", BAD-759): the list's open state, the trail of jumps (where
// the owner was, and which entry they last went to, for Next and Back), and the agents waiting on an
// approval or a question, published by `ForkNeedsYouAgentSource` while any wait.
import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { ExecutionHostId } from '../../../../shared/execution-host/execution-host'
import type { DashboardCard } from '../../../../shared/agent-status/presentation/dashboard-snapshot'
import { readForkNeedsYouSettings } from '../../../../shared/fork/needs-you'
import type { NeedsYouEntry } from './needs-you-view'

/** Where the owner was before the first jump of a trail. */
export type NeedsYouReturn = {
  activeView: AppState['activeView']
  worktreeId: string | null
  hostId: ExecutionHostId | null
  tabId: string | null
  tabType: AppState['activeTabType']
  rightSidebarOpen: boolean
  rightSidebarTab: AppState['rightSidebarTab']
}

export type NeedsYouTrail = {
  ret: NeedsYouReturn | null
  /** The entry last jumped to, and its place in the list then. */
  last: { key: string; index: number } | null
}

const NO_TRAIL: NeedsYouTrail = { ret: null, last: null }

export type NeedsYouData = {
  entries: readonly NeedsYouEntry[]
  /** Chats the Decision inbox keeps apart (stalled, paused): not listed, counted for its link. */
  inboxOnly: number
}

export const NEEDS_YOU_NONE: NeedsYouData = { entries: [], inboxOnly: 0 }
let data: NeedsYouData = NEEDS_YOU_NONE

let open = false
let trail = NO_TRAIL
let agents: readonly DashboardCard[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function needsYouEnabled(): boolean {
  return readForkNeedsYouSettings(useAppStore.getState().settings).enabled
}

export function useNeedsYouEnabled(): boolean {
  return useAppStore((s) => readForkNeedsYouSettings(s.settings).enabled)
}

export function useNeedsYouQuickAnswers(): boolean {
  return useAppStore((s) => readForkNeedsYouSettings(s.settings).quickAnswers)
}

export function openNeedsYou(): void {
  if (!open && needsYouEnabled()) {
    open = true
    emit()
  }
}

export function closeNeedsYou(): void {
  if (open) {
    open = false
    emit()
  }
}

export function toggleNeedsYou(): void {
  if (open) {
    closeNeedsYou()
  } else {
    openNeedsYou()
  }
}

export function useNeedsYouOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open)
}

export function readNeedsYouTrail(): NeedsYouTrail {
  return trail
}

export function useNeedsYouTrail(): NeedsYouTrail {
  return useSyncExternalStore(subscribe, () => trail)
}

/** Keeps the first return point of a trail: Next after Next still goes Back to where it began. */
export function recordNeedsYouJump(
  from: NeedsYouReturn,
  last: { key: string; index: number }
): void {
  trail = { ret: trail.ret ?? from, last }
  emit()
}

export function endNeedsYouTrail(): void {
  if (trail !== NO_TRAIL) {
    trail = NO_TRAIL
    emit()
  }
}

export function readNeedsYouAgents(): readonly DashboardCard[] {
  return agents
}

function sameCards(a: readonly DashboardCard[], b: readonly DashboardCard[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (card, index) =>
        card.paneKey === b[index]?.paneKey &&
        card.stateChangedAt === b[index]?.stateChangedAt &&
        card.askSummary === b[index]?.askSummary &&
        card.conversationName === b[index]?.conversationName
    )
  )
}

export function publishNeedsYouAgents(next: readonly DashboardCard[]): void {
  if (!sameCards(agents, next)) {
    agents = next
    emit()
  }
}

export function useNeedsYouAgents(): readonly DashboardCard[] {
  return useSyncExternalStore(subscribe, () => agents)
}

export function publishNeedsYouData(next: NeedsYouData): void {
  if (next !== data) {
    data = next
    emit()
  }
}

/** The merged entries as the publisher last computed them, for Next from outside a component. */
export function readNeedsYouEntries(): readonly NeedsYouEntry[] {
  return data.entries
}

export function useNeedsYouData(): NeedsYouData {
  return useSyncExternalStore(subscribe, () => data)
}
