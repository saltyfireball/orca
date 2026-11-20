// Quick task (SLRM-2428): the Settings search entry of the quick task card, kept out of the pane
// catalog so that shared file stays under its line budget. The title matches ForkQuickTaskSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export function quickTaskSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.quickTask.settings.title', 'Quick task'),
    description: t(
      'fork.settingsPane.search.quickTask',
      'A global shortcut opens a box; the task goes to the bot that owns it.'
    ),
    // Setting keys and plain English terms, the same in every language.
    keywords: [
      'quick task',
      'shortcut',
      'hotkey',
      'router',
      'dispatcher',
      'dictate',
      'forkQuickTask',
      'forkQuickTaskShortcut',
      'forkQuickTaskRouterBot',
      'forkQuickTaskPlacementCommand'
    ]
  }
}
