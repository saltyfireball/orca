// Sleepers (SLRM-2136): Settings > Advanced, whether the sidebar toolbar shows the Sleepers
// button. Shown by default; the command palette opens the dialog either way.
import React from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { forkSleepersButtonShown } from '../../../../shared/fork/sleepers'
import {
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'

type ForkSleepersSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkSleepersSetting({
  settings,
  updateSettings
}: ForkSleepersSettingProps): React.JSX.Element {
  const t = useTranslate()
  const shown = forkSleepersButtonShown(settings)
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.sleepers.settings.title', 'Sleepers')}
        description={t(
          'fork.sleepers.settings.description',
          'One list of every chat and terminal agent: working, stalled, waiting on you, queued, idle or asleep.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.sleepers.settings.buttonLabel', 'Show the Sleepers button')}
        description={t(
          'fork.sleepers.settings.buttonHelp',
          'The moon button in the sidebar toolbar. Off hides it; the command palette still opens Sleepers.'
        )}
        checked={shown}
        onChange={() => updateSettings({ forkSleepersButton: !shown })}
      />
    </section>
  )
}
