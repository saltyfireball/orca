// Auto-continue filter (FORK.md, BAD-560): its settings card. Off by default.
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { autoContinueInteractiveOn } from '../../../../shared/fork/auto-continue'
import {
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkAutoContinueSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const on = autoContinueInteractiveOn(settings)
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.autoContinue.title', 'Continue my chats after a restart')}
        description={t(
          'fork.autoContinue.description',
          'Let the automatic continue after a restart or update take your own chats too.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.autoContinue.label', 'Continue my chats too')}
        description={t(
          'fork.autoContinue.help',
          'Orchestration workers and automation runs always carry on by themselves (when "Continue work after a restart" is on). Chats you started keep the restart offer and wait for you unless this is on.'
        )}
        checked={on}
        onChange={() => updateSettings({ forkAutoContinueInteractive: !on })}
      />
    </section>
  )
}
