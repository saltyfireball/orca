// Branch clashes (SLRM-2394): the Settings search entry of the card, kept out of the pane catalog
// so that shared file stays under its line budget. The title matches ForkBranchClashesSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

/** Search keywords: setting keys and plain English terms, the same in every language. */
function words(...terms: string[]): string[] {
  return terms
}

export function branchClashesSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.branchClashes.setting.title', 'Branch clashes'),
    description: t(
      'fork.settingsPane.search.branchClashes',
      'Warn when parallel worktree branches change the same files, or a branch falls far behind.'
    ),
    keywords: words(
      'clash',
      'conflict',
      'overlap',
      'same files',
      'behind',
      'stale',
      'forkBranchClashes',
      'forkBranchClashesIntervalMinutes'
    )
  }
}
