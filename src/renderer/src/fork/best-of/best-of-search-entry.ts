// Best of N (SLRM-2393): the Settings search entry of the Best of N card, kept out of the pane
// catalog so that shared file stays under its line budget. The title matches ForkBestOfSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export function bestOfSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.bestOf.settings.title', 'Best of N'),
    description: t(
      'fork.settingsPane.search.bestOf',
      'Send one task to several agents, compare their attempts and keep one.'
    ),
    keywords: [
      'best of',
      'attempts',
      'compare',
      'pick',
      'winner',
      'forkBestOf',
      'forkBestOfLoserAction'
    ]
  }
}
