// Set up on a server (SLRM-2312): the Settings search entry of its card, kept out of the pane
// catalog so that shared file stays under its line budget. The title matches ForkServerSetupSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export function serverSetupSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.serverSetup.title', 'Set up on a server'),
    description: t(
      'fork.settingsPane.search.serverSetup',
      'Clone a project onto a paired server that lacks it, from the host picker or --setup-missing.'
    ),
    keywords: [
      'clone',
      'server',
      'remote',
      'setup missing',
      'readiness',
      'direnv',
      'forkServerSetupOffer',
      'forkServerSetupParent',
      'forkServerSetupReadiness'
    ]
  }
}
