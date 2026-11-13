// SLRM-2095: the switches for the child count badge. All three ship on; unset counts as on.
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { translate } from '@/i18n/i18n'

type ForkChildTallySettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkChildTallySetting({
  settings,
  updateSettings
}: ForkChildTallySettingProps): React.JSX.Element {
  const shown = settings.forkShowChildTally !== false
  const countFinished = settings.forkChildTallyCountFinished !== false
  const countTasks = settings.forkChildTallyCountTasks !== false
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('fork.childTally.settingTitle', 'Agent child count')}
        description={translate(
          'fork.childTally.settingDescription',
          'Show how many workers, sub-agents and background tasks each sidebar agent is responsible for.'
        )}
      />
      <SettingsSwitchRow
        label={translate('fork.childTally.settingLabel', 'Show the child count badge')}
        description={translate(
          'fork.childTally.settingHelp',
          'Running and total, such as 3/12. Hover it for the list.'
        )}
        checked={shown}
        onChange={() => updateSettings({ forkShowChildTally: !shown })}
      />
      <SettingsSwitchRow
        label={translate('fork.childTally.finishedLabel', 'Count finished children')}
        description={translate(
          'fork.childTally.finishedHelp',
          'When off, the badge shows only the children still running.'
        )}
        checked={countFinished}
        disabled={!shown}
        onChange={() => updateSettings({ forkChildTallyCountFinished: !countFinished })}
      />
      <SettingsSwitchRow
        label={translate('fork.childTally.tasksLabel', 'Count background tasks')}
        description={translate(
          'fork.childTally.tasksHelp',
          'Include background shell commands and monitors an agent started.'
        )}
        checked={countTasks}
        disabled={!shown}
        onChange={() => updateSettings({ forkChildTallyCountTasks: !countTasks })}
      />
    </section>
  )
}
