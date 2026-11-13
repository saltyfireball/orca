// Chat sleep (FORK.md) settings. Ships off; main reads them on every idle sweep tick.
import React, { useId } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  FORK_CHAT_SLEEP_MINUTE_CHOICES,
  forkChatSleepEnabled,
  forkChatSleepIdleMinutes,
  forkChatSleepKeepVisible
} from '../../../../shared/fork/chat-sleep'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { translate } from '@/i18n/i18n'
import { useIntlLocale } from '@/i18n/use-translate'
import { formatMinutesDuration } from '@/i18n/ui-intl-formatters'

type ForkChatSleepSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkChatSleepSetting({
  settings,
  updateSettings
}: ForkChatSleepSettingProps): React.JSX.Element {
  const intlLocale = useIntlLocale()
  const labelId = useId()
  const enabled = forkChatSleepEnabled(settings)
  const minutes = forkChatSleepIdleMinutes(settings)
  const keepVisible = forkChatSleepKeepVisible(settings)
  // Keep a hand-edited value selectable rather than showing a blank trigger.
  const choices = FORK_CHAT_SLEEP_MINUTE_CHOICES.includes(minutes)
    ? FORK_CHAT_SLEEP_MINUTE_CHOICES
    : [minutes, ...FORK_CHAT_SLEEP_MINUTE_CHOICES]
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('fork.chatSleep.title', 'Chat sleep (experimental)')}
        description={translate(
          'fork.chatSleep.description',
          'Free the memory of chats you are not using. A sleeping chat keeps its tab and transcript, and the next message to it, typed or sent by another agent, wakes it on the same session.'
        )}
      />
      <SettingsSwitchRow
        label={translate('fork.chatSleep.label', 'Sleep idle chats')}
        description={translate(
          'fork.chatSleep.help',
          'A chat that is working, waiting on you, running background work or holding a message is never put to sleep. While this is on, its idle time replaces the stop idle chats setting.'
        )}
        checked={enabled}
        onChange={() => updateSettings({ forkChatSleep: !enabled })}
      />
      <SettingsRow
        label={translate('fork.chatSleep.idleLabel', 'Sleep after')}
        description={translate(
          'fork.chatSleep.idleHelp',
          'How long a chat sits idle before it sleeps. Chats are checked every 5 minutes.'
        )}
        labelId={labelId}
        control={
          <Select
            value={String(minutes)}
            disabled={!enabled}
            onValueChange={(value) => updateSettings({ forkChatSleepIdleMinutes: Number(value) })}
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={labelId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {formatMinutesDuration(choice, intlLocale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsSwitchRow
        label={translate('fork.chatSleep.keepVisibleLabel', 'Keep chats on screen awake')}
        description={translate(
          'fork.chatSleep.keepVisibleHelp',
          'A chat open in the current workspace does not sleep, however long it is idle.'
        )}
        checked={keepVisible}
        disabled={!enabled}
        onChange={() => updateSettings({ forkChatSleepKeepVisible: !keepVisible })}
      />
    </section>
  )
}
