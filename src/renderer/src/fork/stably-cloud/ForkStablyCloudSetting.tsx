// Upstream cloud services (BAD-896, FORK.md "One switch for upstream's cloud services"): one switch
// for every hosted service that belongs to the upstream project.
import React from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { forkStablyCloudEnabled } from '../../../../shared/fork/stably-cloud'
import {
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkStablyCloudSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const enabled = forkStablyCloudEnabled(settings)
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.stablyCloud.title', "Upstream's cloud services")}
        description={t(
          'fork.stablyCloud.description',
          "Sign-in, the phone relay, phone push, connectors, share links, the what's-new feeds and the plugin install counts and safety list are hosted by the Orca project, not by this app. Off: none of them is called. Direct phone pairing over your network or a VPN keeps working. Applies to new requests; restart to stop services already running."
        )}
      />
      <SettingsSwitchRow
        label={t('fork.stablyCloud.label', "Use upstream's cloud services")}
        description={t(
          'fork.stablyCloud.help',
          'Off by default in this build unless it was built with the default on. On a server: `orca settings set forkStablyCloudEnabled true --environment <name>`.'
        )}
        checked={enabled}
        onChange={() => updateSettings({ forkStablyCloudEnabled: !enabled })}
      />
    </section>
  )
}
