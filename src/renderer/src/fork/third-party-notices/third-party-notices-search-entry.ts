// Third-party notices (BAD-897): the fork pane's About section and the search entry of its card.
// The title matches ForkThirdPartyNoticesSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export function thirdPartyNoticesSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.thirdPartyNotices.title', 'Third-party notices'),
    description: t(
      'fork.settingsPane.search.thirdPartyNotices',
      'The licenses of the open-source software this app includes.'
    ),
    keywords: ['about', 'license', 'licenses', 'notices', 'open source', 'copyright', 'mit']
  }
}

/** The About section's title, description and search entries, for the pane catalog. */
export function getForkAboutSectionParts(
  t: Translate = translate
): [title: string, description: string, entries: SettingsSearchEntry[]] {
  return [
    t('fork.settingsPane.about.title', 'About'),
    t('fork.settingsPane.about.description', 'The licenses of the software this app includes.'),
    [thirdPartyNoticesSearchEntry(t)]
  ]
}
