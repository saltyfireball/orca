// SLRM-2270: the Settings search entry of the fast new worktrees card, kept out of the pane
// catalog so that shared file stays under its line budget. The title matches ForkApfsCloneSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

/** Search keywords: setting keys and plain English terms, the same in every language. */
function words(...terms: string[]): string[] {
  return terms
}

export function apfsCloneSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.apfsClone.title', 'Fast new worktrees (macOS)'),
    description: t(
      'fork.settingsPane.search.apfsClone',
      'Clone the checkout and ignored folders such as node_modules into new worktrees on APFS.'
    ),
    keywords: words(
      'apfs',
      'clone',
      'copy on write',
      'worktree',
      'node_modules',
      'checkout',
      'forkApfsCloneCheckout',
      'forkApfsCloneFolders'
    )
  }
}
