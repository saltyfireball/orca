// Digest (SLRM-2388): the Settings search entry of the digest card, kept out of the pane catalog
// so that shared file stays under its line budget. The title matches ForkDigestSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export function digestSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.digest.settings.title', 'Digest'),
    description: t(
      'fork.settingsPane.search.digest',
      'A daily summary of finished, failed, merged and cost, and what waits on you, across your servers.'
    ),
    // Setting keys and plain English terms, the same in every language.
    keywords: [
      'digest',
      'overnight',
      'morning',
      'summary',
      'daily',
      'forkDigest',
      'forkDigestHour',
      'forkDigestCommand'
    ]
  }
}
