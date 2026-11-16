// Settings search entry for the Auto placement card (SLRM-2266). Kept here so the shared pane
// catalog stays under its line limit; the title matches the card's header.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export function forkAutoPlacementSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.autoPlacement.title', 'Auto placement'),
    description: t(
      'fork.settingsPane.search.autoPlacement',
      'Start new workers and worktrees on the machine with the most spare CPU and memory.'
    ),
    keywords: ['machine', 'host', 'server', 'load', 'balance', 'forkPlacement']
  }
}
