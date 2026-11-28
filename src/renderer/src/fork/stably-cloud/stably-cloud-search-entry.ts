// Upstream cloud services (BAD-896): the Settings search entry of its card, appended to the Remote
// servers section. The title matches ForkStablyCloudSetting.
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export function stablyCloudSearchEntry(t: Translate = translate): SettingsSearchEntry {
  return {
    title: t('fork.stablyCloud.title', "Upstream's cloud services"),
    description: t(
      'fork.settingsPane.search.stablyCloud',
      "One switch for sign-in, the phone relay, push, connectors, share links and upstream's feeds."
    ),
    keywords: [
      'cloud',
      'sign in',
      'relay',
      'push',
      'connector',
      'share',
      'offline',
      'privacy',
      'forkStablyCloudEnabled'
    ]
  }
}
