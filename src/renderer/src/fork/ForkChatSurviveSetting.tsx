// SLRM-1394: the switch for chat survive. Ships off; the main process reads it on every spawn.
import type { GlobalSettings } from '../../../shared/global-settings-types'
import {
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../components/settings/form-controls/SettingsFormControls'
import { translate } from '@/i18n/i18n'

type ForkChatSurviveSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkChatSurviveSetting({
  settings,
  updateSettings
}: ForkChatSurviveSettingProps): React.JSX.Element {
  const enabled = settings.forkChatSurvive === true
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('fork.chatSurvive.title', 'Chat survive (experimental)')}
        description={translate(
          'fork.chatSurvive.description',
          'Keep Claude chats running in the background while Orca restarts.'
        )}
      />
      <SettingsSwitchRow
        label={translate('fork.chatSurvive.label', 'Keep Claude chats through a restart')}
        description={translate(
          'fork.chatSurvive.help',
          'Applies to Claude chats started after you switch it. Codex chats are not affected.'
        )}
        checked={enabled}
        onChange={() => updateSettings({ forkChatSurvive: !enabled })}
      />
    </section>
  )
}
