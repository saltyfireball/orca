// SLRM-2390: the switches for what agent rows show beside their title. All ship on; unset is on.
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'
import { forkRowStatusConfig } from '../../../../shared/fork/row-status'

type ForkRowStatusSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkRowStatusSetting({
  settings,
  updateSettings
}: ForkRowStatusSettingProps): React.JSX.Element {
  const t = useTranslate()
  const config = forkRowStatusConfig(settings)
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.rowStatus.settingTitle', 'Agent row status')}
        description={t(
          'fork.rowStatus.settingDescription',
          "Show each agent's spend, context and pull request checks on its sidebar row."
        )}
      />
      <SettingsSwitchRow
        label={t('fork.rowStatus.spendLabel', 'Show spend')}
        description={t(
          'fork.rowStatus.spendHelp',
          'Estimated cost of a native Claude chat, priced like the usage report. A subscription chat shows what its tokens would cost, marked with ~.'
        )}
        checked={config.spend}
        onChange={() => updateSettings({ forkRowSpend: !config.spend })}
      />
      <SettingsSwitchRow
        label={t('fork.rowStatus.contextLabel', 'Show context size')}
        description={t(
          'fork.rowStatus.contextHelp',
          "Tokens a native Claude chat's last call read: what its next message re-reads."
        )}
        checked={config.context}
        onChange={() => updateSettings({ forkRowContext: !config.context })}
      />
      <SettingsSwitchRow
        label={t('fork.rowStatus.prLabel', 'Show the pull request')}
        description={t(
          'fork.rowStatus.prHelp',
          "The workspace's pull request, colored by its checks: pending, passing or failing."
        )}
        checked={config.pr}
        onChange={() => updateSettings({ forkRowPrChip: !config.pr })}
      />
      <SettingsSwitchRow
        label={t('fork.rowStatus.fixLabel', 'Show Ask agent to fix')}
        description={t(
          'fork.rowStatus.fixHelp',
          'When the checks fail, a Fix button sends the failing checks and their logs to that agent.'
        )}
        checked={config.fix}
        disabled={!config.pr}
        onChange={() => updateSettings({ forkRowFixChecks: settings.forkRowFixChecks === false })}
      />
    </section>
  )
}
