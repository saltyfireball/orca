// PR babysitter (FORK.md, SLRM-2386): the one live copy of this host's babysat pull requests that
// every PR row's status line reads. It reads `window.api.forkIdleRecovery.babysit` when its first
// reader arrives and again on each inbox change event; nothing polls. With no reader it holds
// nothing and listens to nothing.
import { useSyncExternalStore } from 'react'
import type { ForkPrBabysitListResult } from '../../../../shared/fork/pr-babysit-wire'

let snapshot: ForkPrBabysitListResult | null = null
let stopListening: (() => void) | null = null
let generation = 0
const readers = new Set<() => void>()

function bridge() {
  const api = window.api?.forkIdleRecovery
  return api?.babysit ? api : null
}

function publish(next: ForkPrBabysitListResult | null): void {
  snapshot = next
  for (const reader of readers) {
    reader()
  }
}

async function refresh(): Promise<void> {
  const api = bridge()
  if (!api?.babysit || readers.size === 0) {
    return
  }
  generation += 1
  const mine = generation
  try {
    const result = await api.babysit()
    if (mine === generation) {
      publish(result)
    }
  } catch {
    // A failed read keeps the last list; the next change event reads again.
  }
}

function subscribe(reader: () => void): () => void {
  readers.add(reader)
  if (readers.size === 1) {
    stopListening = bridge()?.onChanged(() => void refresh()) ?? null
    void refresh()
  }
  return () => {
    readers.delete(reader)
    if (readers.size === 0) {
      stopListening?.()
      stopListening = null
      generation += 1
      snapshot = null
    }
  }
}

export function useForkPrBabysitList(): ForkPrBabysitListResult | null {
  return useSyncExternalStore(subscribe, () => snapshot)
}
