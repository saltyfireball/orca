// Settings search entry for the Batch start card (SLRM-2395). Kept here so the shared pane catalog
// stays under its line limit; the title matches the card's header.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export function forkBatchStartSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.batchStart.settingTitle', 'Batch start'),
    description: t(
      'fork.settingsPane.search.batchStart',
      'Send prompt after prompt from the new-workspace composer, one worktree and agent per model.'
    ),
    keywords: ['batch', 'prompt', 'keep open', 'models', 'set up', 'clone', 'forkBatchStart']
  }
}
