// SLRM-2384: the Settings search entry of the keep main current card, kept out of the pane catalog
// so that shared file stays under its line budget. The title matches ForkMainSyncSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

/** Search keywords: setting keys and plain English terms, the same in every language. */
function words(...terms: string[]): string[] {
  return terms
}

export function mainSyncSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.mainSync.title', 'Keep main current'),
    description: t(
      'fork.settingsPane.search.mainSync',
      "Fetch and fast-forward each project's default branch on a timer."
    ),
    keywords: words(
      'main',
      'default branch',
      'fetch',
      'fast-forward',
      'pull',
      'sync',
      'forkMainSync',
      'forkMainSyncMinutes',
      'forkMainSyncProjects',
      'forkMainSyncSkipInUse'
    )
  }
}
