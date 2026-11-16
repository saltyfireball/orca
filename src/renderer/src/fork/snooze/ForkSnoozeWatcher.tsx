// Snooze (FORK.md, SLRM-2269): ends snoozes in this window. It looks after each store change
// (at most twice a second) and every 30 s: a snooze wakes when it is opened, when one of its
// agents needs an approval or fails, and when its time comes; one set until merge or idle days
// settles, and main runs the cleanup command if the user set one. Hidden merge cards get their
// review refreshed every 10 minutes so a merge is seen. Mounted once through ForkRootHosts.
import { useEffect } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import {
  FORK_SNOOZE_SETTLE_REASONS,
  forkSnoozeWakeReason,
  readForkSnoozeSettings,
  type ForkSnoozeEntry,
  type ForkSnoozeWakeReason
} from '../../../../shared/fork/snooze'
import {
  readForkSnoozeEntries,
  settleForkSnoozeEntry,
  subscribeForkSnooze,
  wakeForkSnooze
} from './snooze-client'
import {
  forkSnoozeWorktree,
  readForkSnoozeFacts,
  readForkSnoozeFocus,
  refreshForkSnoozeReview,
  type ForkSnoozeFocus
} from './snooze-watch'

const TICK_MS = 30_000
const THROTTLE_MS = 500
const REVIEW_REFRESH_MS = 10 * 60_000

function announce(entry: ForkSnoozeEntry, reason: ForkSnoozeWakeReason, cleanup: string): void {
  const name = entry.label
  if (reason === 'attention') {
    toast.message(
      translate('fork.snooze.toast.attention', '{{name}} is back: it needs you.', { name })
    )
  } else if (reason === 'failed') {
    toast.message(
      translate('fork.snooze.toast.agentFailed', '{{name}} is back: its agent failed.', { name })
    )
  } else if (cleanup === 'failed' || cleanup === 'timeout') {
    toast.error(
      translate(
        'fork.snooze.toast.cleanupFailed',
        'The snooze cleanup command for {{name}} failed.',
        {
          name
        }
      )
    )
  }
}

async function end(entry: ForkSnoozeEntry, reason: ForkSnoozeWakeReason): Promise<void> {
  if (!FORK_SNOOZE_SETTLE_REASONS.includes(reason)) {
    if (await wakeForkSnooze(entry.id, reason)) {
      announce(entry, reason, 'none')
    }
    return
  }
  const state = useAppStore.getState()
  const worktree = forkSnoozeWorktree(state, entry)
  const outcome = await settleForkSnoozeEntry(entry.id, reason, {
    ...(worktree?.path ? { path: worktree.path } : {}),
    ...(worktree?.branch ? { branch: worktree.branch } : {})
  })
  if (outcome.woke) {
    announce(entry, reason, outcome.cleanup)
  }
}

export function ForkSnoozeWatcher(): null {
  useEffect(() => {
    let previous: ForkSnoozeFocus = readForkSnoozeFocus(useAppStore.getState())
    const inFlight = new Set<string>()
    const reviewedAt = new Map<string, number>()
    let timer: ReturnType<typeof setTimeout> | null = null

    const check = (): void => {
      timer = null
      const state = useAppStore.getState()
      const current = readForkSnoozeFocus(state)
      const entries = readForkSnoozeEntries()
      const settings = readForkSnoozeSettings(state.settings)
      const now = Date.now()
      if (settings.enabled) {
        for (const entry of entries) {
          if (inFlight.has(entry.id)) {
            continue
          }
          const facts = readForkSnoozeFacts(state, entry, { now, previous, current })
          const reason = forkSnoozeWakeReason(entry, facts, settings)
          if (reason) {
            inFlight.add(entry.id)
            void end(entry, reason).finally(() => inFlight.delete(entry.id))
          } else if (
            entry.until.kind === 'merge' &&
            now - (reviewedAt.get(entry.id) ?? 0) >= REVIEW_REFRESH_MS
          ) {
            reviewedAt.set(entry.id, now)
            refreshForkSnoozeReview(state, forkSnoozeWorktree(state, entry))
          }
        }
      }
      previous = current
    }
    const schedule = (): void => {
      if (readForkSnoozeEntries().length === 0) {
        // Keep the last place current, so a new snooze of the open workspace is not "opened".
        previous = readForkSnoozeFocus(useAppStore.getState())
      } else if (timer === null) {
        timer = setTimeout(check, THROTTLE_MS)
      }
    }
    const stopStore = useAppStore.subscribe(schedule)
    const stopSnooze = subscribeForkSnooze(schedule)
    const stopTick = installWindowVisibilityInterval({ run: check, intervalMs: TICK_MS })
    return () => {
      stopStore()
      stopSnooze()
      stopTick()
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
  }, [])
  return null
}
