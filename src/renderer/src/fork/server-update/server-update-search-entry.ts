// Server updates (SLRM-2310): the Settings search entry of the Server updates card, appended to
// the Remote servers section. The title matches ForkServerUpdateSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

/** Search keywords: setting keys and plain English terms, the same in every language. */
function words(...terms: string[]): string[] {
  return terms
}

export function serverUpdateSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.serverUpdate.title', 'Server updates'),
    description: t(
      'fork.settingsPane.search.serverUpdate',
      "Update paired servers to this desktop's version, one at a time, with a rollback."
    ),
    keywords: words('update', 'upgrade', 'server', 'version', 'rollback', 'forkServerUpdateAuto')
  }
}
