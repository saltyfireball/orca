// SLRM-2265: the Settings search entry of the Move to host card, kept out of the pane catalog so
// that shared file stays under its line budget. The title matches ForkWorktreeMoveSettings.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

/** Search keywords: setting keys and plain English terms, the same in every language. */
function words(...terms: string[]): string[] {
  return terms
}

export function worktreeMoveSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.worktreeMove.settingTitle', 'Move to host'),
    description: t(
      'fork.settingsPane.search.worktreeMove',
      'Move a workspace and its chats to another host: push, patch, chats and the moved mark.'
    ),
    keywords: words('move', 'host', 'server', 'worktree', 'transfer', 'forkWorktreeMove')
  }
}
