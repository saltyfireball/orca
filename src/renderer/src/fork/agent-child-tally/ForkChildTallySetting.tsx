// SLRM-2095: the switches for the child count badge. All three ship on; unset counts as on.
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'

type ForkChildTallySettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkChildTallySetting({
  settings,
  updateSettings
}: ForkChildTallySettingProps): React.JSX.Element {
  const t = useTranslate()
  const shown = settings.forkShowChildTally !== false
  const countFinished = settings.forkChildTallyCountFinished !== false
  const countTasks = settings.forkChildTallyCountTasks !== false
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.childTally.settingTitle', 'Agent child count')}
        description={t(
          'fork.childTally.settingDescription',
          'Show how many workers, sub-agents and background tasks each sidebar agent is responsible for.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.childTally.settingLabel', 'Show the child count badge')}
        description={t(
          'fork.childTally.settingHelp',
          'Running and total, such as 3/12. Hover it for the list.'
        )}
        checked={shown}
        onChange={() => updateSettings({ forkShowChildTally: !shown })}
      />
      <SettingsSwitchRow
        label={t('fork.childTally.finishedLabel', 'Count finished children')}
        description={t(
          'fork.childTally.finishedHelp',
          'When off, the badge shows only the children still running.'
        )}
        checked={countFinished}
        disabled={!shown}
        onChange={() => updateSettings({ forkChildTallyCountFinished: !countFinished })}
      />
      <SettingsSwitchRow
        label={t('fork.childTally.tasksLabel', 'Count background tasks')}
        description={t(
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
