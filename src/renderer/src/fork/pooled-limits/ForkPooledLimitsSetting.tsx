// Pooled limits (FORK.md, SLRM-2392): its settings card. Both switches ship on; unset counts as on.
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { readForkPooledLimitsSettings } from '../../../../shared/fork/pooled-limits'
import {
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkPooledLimitsSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const config = readForkPooledLimitsSettings(settings)
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.pooledLimits.settingTitle', 'Pooled usage limits')}
        description={t(
          'fork.pooledLimits.settingDescription',
          'One bar per Claude and Codex limit window across every account on this machine and its paired servers.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.pooledLimits.settingLabel', 'Pool usage limits')}
        description={t(
          'fork.pooledLimits.settingHelp',
          'Shown in the usage popover, /usage-limits and orca limits usage. Off also stops this machine answering paired desktops. Only usage numbers are shared, never tokens.'
        )}
        checked={config.enabled}
        onChange={() => updateSettings({ forkPooledLimits: !config.enabled })}
      />
      <SettingsSwitchRow
        label={t('fork.pooledLimits.serversLabel', 'Include paired servers')}
        description={t(
          'fork.pooledLimits.serversHelp',
          'Ask each paired server for its accounts. An account signed in on several machines counts once.'
        )}
        checked={config.servers}
        disabled={!config.enabled}
        onChange={() => updateSettings({ forkPooledLimitsServers: !config.servers })}
      />
    </section>
  )
}
