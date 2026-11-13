// SLRM-2096 (FORK.md "Lost work"): the always-mounted Lost work dialog, so the command palette
// and the Sleepers dialog can open it without going through workspace cleanup.
import React, { useSyncExternalStore } from 'react'
import { ForkLostWorkDialog } from './ForkLostWorkDialog'

let open = false
const listeners = new Set<() => void>()

function setOpen(next: boolean): void {
  open = next
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

/** False when this build's preload has no lost work bridge (a web or remote client). */
export function forkLostWorkAvailable(): boolean {
  return Boolean(window.api?.forkLostWork)
}

export function openForkLostWork(): void {
  if (forkLostWorkAvailable()) {
    setOpen(true)
  }
}

export function ForkLostWorkHost(): React.JSX.Element | null {
  const isOpen = useSyncExternalStore(subscribe, () => open)
  return isOpen ? <ForkLostWorkDialog open onOpenChange={setOpen} /> : null
}
