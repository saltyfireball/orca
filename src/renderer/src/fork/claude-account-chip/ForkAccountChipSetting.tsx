// SLRM-1503: the switch for the Claude account chip. Ships on; unset counts as on.
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'

type ForkAccountChipSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkAccountChipSetting({
  settings,
  updateSettings
}: ForkAccountChipSettingProps): React.JSX.Element {
  const t = useTranslate()
  const enabled = settings.forkShowAccountChip !== false
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.accountChip.settingTitle', 'Claude account chip')}
        description={t(
          'fork.accountChip.settingDescription',
          'Mark tabs, agents and worktrees with the Claude account they run on.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.accountChip.settingLabel', 'Show the Claude account chip')}
        description={t(
          'fork.accountChip.settingHelp',
          'Shown only when a host has more than one Claude account. Remote hosts show their own accounts.'
        )}
        checked={enabled}
        onChange={() => updateSettings({ forkShowAccountChip: !enabled })}
      />
    </section>
  )
}
