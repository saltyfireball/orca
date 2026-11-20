// Worker archive (BAD-669): the Settings search entry of the card, kept out of the pane catalog so
// that shared file stays under its line budget. The title matches ForkWorkerArchiveSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export function workerArchiveSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.workerArchive.title', 'Finished worker workspaces'),
    description: t(
      'fork.settingsPane.search.workerArchive',
      'Archive the workspaces of finished workers and stop their idle terminals.'
    ),
    keywords: [
      'orchestration',
      'workers',
      'workspace',
      'archive',
      'remove',
      'terminal',
      'forkWorkerArchive',
      'forkWorkerArchiveDelayMinutes',
      'forkWorkerTerminalStopMinutes'
    ]
  }
}
