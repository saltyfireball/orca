// Unattended resume (FORK.md, SLRM-2268): its settings card. On by default; the main process
// reads it once at start-up, in the desktop app and in the headless server alike.
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  readUnattendedResumeSettings,
  UNATTENDED_RESUME_DEFAULT_MAX_TRIES,
  UNATTENDED_RESUME_MAX_MAX_TRIES,
  UNATTENDED_RESUME_MIN_MAX_TRIES
} from '../../../../shared/fork/unattended-resume'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'
import { ForkNumberInput } from '../cache-cold/ForkNumberInput'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkUnattendedResumeSetting({
  settings,
  updateSettings
}: Props): React.JSX.Element {
  const t = useTranslate()
  const config = readUnattendedResumeSettings(settings)
  const triesLabel = t('fork.unattendedResume.maxTries', 'Tries in a row')
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.unattendedResume.title', 'Unattended resume')}
        description={t(
          'fork.unattendedResume.description',
          'Continue interrupted workers and automation runs after a restart or update.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.unattendedResume.label', 'Continue unattended work by itself')}
        description={t(
          'fork.unattendedResume.help',
          'Orchestration workers and automation runs carry on without waiting for you. A turn that was waiting on an approval or a question is left for you. Chats you started keep the usual offer.'
        )}
        checked={config.enabled}
        onChange={() => updateSettings({ forkUnattendedResume: !config.enabled })}
      />
      <SettingsRow
        label={triesLabel}
        description={t(
          'fork.unattendedResume.maxTriesHelp',
          'Default {{count}}. After this many automatic continuations of one chat in a row, it waits for you, so a crash loop stops.',
          { count: UNATTENDED_RESUME_DEFAULT_MAX_TRIES }
        )}
        control={
          <ForkNumberInput
            value={config.maxTries}
            label={triesLabel}
            min={UNATTENDED_RESUME_MIN_MAX_TRIES}
            max={UNATTENDED_RESUME_MAX_MAX_TRIES}
            disabled={!config.enabled}
            onCommit={(next) => updateSettings({ forkUnattendedResumeMaxTries: next })}
          />
        }
      />
    </section>
  )
}
