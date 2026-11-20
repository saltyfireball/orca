// Bot starting rules (SLRM-2459): the Settings search entry of its card, apart from the card so
// the pane catalog does not import a component. The title matches ForkBotStartingRulesSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export function botStartingRulesSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.botStartingRules.settings.title', 'Bot starting rules'),
    description: t(
      'fork.settingsPane.search.botStartingRules',
      "The rules a new bot's SOUL.md starts with, in place of the read-only default."
    ),
    // Setting keys and plain English terms, the same in every language.
    keywords: ['bot', 'bots', 'soul', 'rules', 'never', 'read-only', 'forkBotStartingRules']
  }
}
