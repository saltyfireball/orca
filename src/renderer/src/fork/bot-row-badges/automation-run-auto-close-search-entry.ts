// Auto-close finished automation run chats (BAD-848): the Settings search entry of its rows, kept out
// of the pane catalog so that shared file stays under its line budget. The rows are in
// ForkBotRowBadgesSetting, after the bot chat auto-close rows.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

/** Search keywords: setting keys and plain English terms, the same in every language. */
function words(...terms: string[]): string[] {
  return terms
}

export function automationRunAutoCloseSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.automationRunAutoClose.label', 'Close finished automation run chats'),
    description: t(
      'fork.settingsPane.search.automationRunAutoClose',
      'Close the chat tab of a finished automation run by itself, with its history kept.'
    ),
    keywords: words(
      'automation',
      'run',
      'chat',
      'tab',
      'close',
      'auto-close',
      'grace',
      'forkAutomationRunAutoClose',
      'forkAutomationRunAutoCloseGraceMinutes'
    )
  }
}
