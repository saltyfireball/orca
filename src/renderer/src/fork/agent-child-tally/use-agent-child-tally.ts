// SLRM-2095: the store side of the child tally. One cached answer per set of root rows.
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { selectVisibleAgentOrchestration } from '@/runtime/agent-orchestration/visible-agent-orchestration'
import type { AgentStatusEntry } from '../../../../shared/agent-status/contracts/agent-status-types'
import {
  EMPTY_CHILD_TALLY,
  childTallySignature,
  tallyAgentChildren,
  type ChildTally,
  type ChildTallyOptions
} from './agent-child-tally'

type TallyState = Pick<
  AppState,
  | 'settings'
  | 'agentStatusByPaneKey'
  | 'runtimeAgentOrchestrationByPaneKey'
  | 'unifiedTabsByWorktree'
  | 'tabsByWorktree'
> &
  Parameters<typeof selectVisibleAgentOrchestration>[0]

/** Settings > Blackfish; unset counts as on for all three. */
export function childTallyEnabled(state: Pick<AppState, 'settings'>): boolean {
  return state.settings?.forkShowChildTally !== false
}

export function childTallyOptions(state: Pick<AppState, 'settings'>): ChildTallyOptions {
  return {
    countFinished: state.settings?.forkChildTallyCountFinished !== false,
    countTasks: state.settings?.forkChildTallyCountTasks !== false
  }
}

type CacheSlot = {
  inputs: readonly unknown[]
  signature: string
  tally: ChildTally
}

/** Synthetic sub-agent keys already use NUL, so roots join on a different control character. */
const ROOT_SEPARATOR = '\u0003'

// Roots are few (one per visible agent row and card), so the cache stays small; cap it anyway.
const CACHE_LIMIT = 512
const cache = new Map<string, CacheSlot>()

export function _resetChildTallyStoreCacheForTest(): void {
  cache.clear()
}

/** The tally for the joined root pane keys, or the previous object when nothing it reads changed. */
export function selectAgentChildTally(state: TallyState, rootKey: string): ChildTally {
  if (!rootKey || !childTallyEnabled(state)) {
    return EMPTY_CHILD_TALLY
  }
  const contexts = selectVisibleAgentOrchestration(state)
  // Since upstream 1.4.261 finished agents stay in the live map (no separate retained map).
  const live = state.agentStatusByPaneKey
  const options = childTallyOptions(state)
  const inputs = [contexts, live, options.countFinished, options.countTasks]
  const previous = cache.get(rootKey)
  if (previous && inputs.every((value, index) => value === previous.inputs[index])) {
    return previous.tally
  }
  const tally = tallyAgentChildren(
    rootKey.split(ROOT_SEPARATOR),
    {
      contexts,
      entryFor: (paneKey) => live.get(paneKey),
      entries: (): Iterable<AgentStatusEntry> => live.values()
    },
    options
  )
  const signature = childTallySignature(tally)
  const kept = previous?.signature === signature ? previous.tally : tally
  if (!previous && cache.size >= CACHE_LIMIT) {
    cache.clear()
  }
  cache.set(rootKey, { inputs, signature, tally: kept })
  return kept
}

/** Root pane keys joined into one cache key. */
export function childTallyRootKey(paneKeys: readonly string[]): string {
  return paneKeys.join(ROOT_SEPARATOR)
}

export function useAgentChildTally(rootKey: string): ChildTally {
  return useAppStore((s) => selectAgentChildTally(s, rootKey))
}
