// PR babysitter (SLRM-2386): the Settings search entry of its card. The title matches
// ForkPrBabysitSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

/** Search keywords: setting keys and plain English terms, the same in every language. */
function words(...terms: string[]): string[] {
  return terms
}

export function prBabysitSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.prBabysit.settings.title', 'PR babysitter'),
    description: t(
      'fork.settingsPane.search.prBabysit',
      'Send a pull request chat fix requests when CI fails, and merge on green when allowed.'
    ),
    keywords: words(
      'pull request',
      'ci',
      'checks',
      'fix',
      'auto-merge',
      'merge',
      'babysit',
      'forkPrBabysitRepos',
      'forkPrBabysitAutoMerge'
    )
  }
}
