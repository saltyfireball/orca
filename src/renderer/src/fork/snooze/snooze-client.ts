// Snooze (FORK.md, SLRM-2269): the window's copy of the snoozes, kept in step with main (which
// pushes every change, from this window or from `orca snooze`), and the window's actions.
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  ForkSnoozeEntry,
  ForkSnoozeTarget,
  ForkSnoozeUntil,
  ForkSnoozeWakeReason
} from '../../../../shared/fork/snooze'
import type {
  ForkSnoozeSettleContext,
  ForkSnoozeSettleOutcome
} from '../../../../shared/fork/snooze-wire'

const EMPTY: readonly ForkSnoozeEntry[] = []
let entries: readonly ForkSnoozeEntry[] = EMPTY
let attached = false
const listeners = new Set<() => void>()

function api() {
  return typeof window === 'undefined' ? undefined : window.api?.forkSnooze
}

function publish(next: readonly ForkSnoozeEntry[]): void {
  entries = next.length === 0 ? EMPTY : next
  for (const listener of listeners) {
    listener()
  }
}

function attach(): void {
  const bridge = api()
  if (attached || !bridge) {
    return
  }
  attached = true
  bridge.onChanged(publish)
  void bridge
    .list()
    .then(publish)
    .catch(() => undefined)
}

export function subscribeForkSnooze(listener: () => void): () => void {
  attach()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function readForkSnoozeEntries(): readonly ForkSnoozeEntry[] {
  return entries
}

/** Test hook: replace the window's copy. */
export function setForkSnoozeEntriesForTest(next: readonly ForkSnoozeEntry[]): void {
  publish(next)
}

export async function snoozeForkTarget(
  target: ForkSnoozeTarget,
  until: ForkSnoozeUntil,
  label: string
): Promise<void> {
  const bridge = api()
  try {
    const entry = bridge ? await bridge.snooze({ target, until, label }) : null
    if (!entry) {
      throw new Error(
        translate('fork.snooze.toast.refused', 'Snooze is off or the time is not ahead.')
      )
    }
  } catch (error) {
    toast.error(translate('fork.snooze.toast.failed', 'Could not snooze it.'), {
      description: error instanceof Error ? error.message : String(error)
    })
  }
}

export async function wakeForkSnooze(id: string, reason: ForkSnoozeWakeReason): Promise<boolean> {
  try {
    return (await api()?.wake(id, reason)) ?? false
  } catch {
    return false
  }
}

export async function settleForkSnoozeEntry(
  id: string,
  reason: ForkSnoozeWakeReason,
  context: ForkSnoozeSettleContext
): Promise<ForkSnoozeSettleOutcome> {
  try {
    return (await api()?.settle(id, reason, context)) ?? { woke: false, cleanup: 'none' }
  } catch {
    return { woke: false, cleanup: 'none' }
  }
}
