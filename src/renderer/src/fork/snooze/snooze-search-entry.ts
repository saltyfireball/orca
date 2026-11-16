// Snooze (SLRM-2269): the Settings search entry of the snooze card, kept out of the pane catalog
// so that shared file stays under its line budget. The title matches ForkSnoozeSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

/** Search keywords: setting keys and plain English terms, the same in every language. */
function words(...terms: string[]): string[] {
  return terms
}

export function snoozeSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.snooze.settings.title', 'Snooze'),
    description: t(
      'fork.settingsPane.search.snooze',
      'Hide a workspace or chat from the sidebar until a time, its merge or some idle days.'
    ),
    keywords: words(
      'snooze',
      'hide',
      'later',
      'remind',
      'merge',
      'idle',
      'cleanup',
      'forkSnooze',
      'forkSnoozeSettleCommand'
    )
  }
}
