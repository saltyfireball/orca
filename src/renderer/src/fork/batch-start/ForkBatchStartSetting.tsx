// Batch start (FORK.md, SLRM-2395) settings: whether the composer offers the Batch switch, and
// how the batch box starts. A phone reads these from the host it is paired with.
import type React from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { readForkBatchStartSettings } from '../../../../shared/fork/batch-start'
import {
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '@/components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkBatchStartSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const config = readForkBatchStartSettings(settings)
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.batchStart.settingTitle', 'Batch start')}
        description={t(
          'fork.batchStart.settingDescription',
          'A Batch switch in the new-workspace composer, on the desktop and the phone: each prompt becomes a worktree and agent per chosen model, started through the launch queue.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.batchStart.settingLabel', 'Offer batch start in the composer')}
        description={t(
          'fork.batchStart.settingHelp',
          'Each prompt clears only after its machine says every model started; failures stay in the box.'
        )}
        checked={config.enabled}
        onChange={() => updateSettings({ forkBatchStart: !config.enabled })}
      />
      <SettingsSwitchRow
        label={t('fork.batchStart.keepOpenLabel', 'Keep the box open by default')}
        description={t(
          'fork.batchStart.keepOpenHelp',
          'Start clears the prompt for the next one instead of closing. Cmd/Ctrl+Enter always keeps it open.'
        )}
        checked={config.keepOpen}
        disabled={!config.enabled}
        onChange={() => updateSettings({ forkBatchStartKeepOpen: !config.keepOpen })}
      />
      <SettingsSwitchRow
        label={t('fork.batchStart.autoHostLabel', 'Auto machine by default')}
        description={t(
          'fork.batchStart.autoHostHelp',
          'Place each prompt on this machine or a paired server by spare CPU and memory, as --host auto does.'
        )}
        checked={config.autoHost}
        disabled={!config.enabled}
        onChange={() => updateSettings({ forkBatchStartAutoHost: !config.autoHost })}
      />
    </section>
  )
}
