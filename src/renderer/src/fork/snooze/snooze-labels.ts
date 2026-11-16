// Snooze (FORK.md, SLRM-2269): the wake label in the window's language, "until 6pm",
// "until Mon 9am", "until merge", on the shared minute clock.
import { useNow } from '@/hooks/use-now'
import { useTranslate } from '@/i18n/use-translate'
import { forkSnoozeTimeText, type ForkSnoozeUntil } from '../../../../shared/fork/snooze'

export function useForkSnoozeLabel(until: ForkSnoozeUntil): string {
  const t = useTranslate()
  const now = useNow(60_000)
  if (until.kind === 'merge') {
    return t('fork.snooze.label.merge', 'until merge')
  }
  if (until.kind === 'idle') {
    return t('fork.snooze.label.idle', 'until {{count}} idle days', { count: until.days })
  }
  return t('fork.snooze.label.time', 'until {{when}}', { when: forkSnoozeTimeText(until.at, now) })
}
