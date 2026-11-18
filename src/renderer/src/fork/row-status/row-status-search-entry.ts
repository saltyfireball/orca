// SLRM-2390: the Settings search entry of the agent row status card, kept out of the pane catalog
// so that shared file stays under its line budget. The title matches ForkRowStatusSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

/** Search keywords: setting keys and plain English terms, the same in every language. */
function words(...terms: string[]): string[] {
  return terms
}

export function rowStatusSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.rowStatus.settingTitle', 'Agent row status'),
    description: t(
      'fork.rowStatus.settingDescription',
      "Show each agent's spend, context and pull request checks on its sidebar row."
    ),
    keywords: words(
      'cost',
      'spend',
      'context',
      'pull request',
      'checks',
      'fix',
      'forkRowSpend',
      'forkRowContext',
      'forkRowPrChip',
      'forkRowFixChecks'
    )
  }
}
