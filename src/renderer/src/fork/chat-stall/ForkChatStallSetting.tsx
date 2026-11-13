// Chat stall (FORK.md) settings. Marking is on at 30 minutes; auto release ships off. Main reads
// both on every idle sweep tick.
import React, { useId } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  FORK_CHAT_STALL_MINUTE_CHOICES,
  forkChatStallAutoRelease,
  forkChatStallMinutes
} from '../../../../shared/fork/chat-stall'
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

type ForkChatStallSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkChatStallSetting({
  settings,
  updateSettings
}: ForkChatStallSettingProps): React.JSX.Element {
  const intlLocale = useIntlLocale()
  const labelId = useId()
  const minutes = forkChatStallMinutes(settings)
  const autoRelease = forkChatStallAutoRelease(settings)
  // Keep a hand-edited value selectable rather than showing a blank trigger.
  const choices = FORK_CHAT_STALL_MINUTE_CHOICES.includes(minutes)
    ? FORK_CHAT_STALL_MINUTE_CHOICES
    : [...FORK_CHAT_STALL_MINUTE_CHOICES, minutes]
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('fork.chatStall.title', 'Stalled chats')}
        description={translate(
          'fork.chatStall.description',
          'A chat whose turn is still open but has had no output from its provider for a while is marked Stalled on its tab and row, with Interrupt, Release and Wake.'
        )}
      />
      <SettingsRow
        label={translate('fork.chatStall.minutesLabel', 'Mark stalled after')}
        description={translate(
          'fork.chatStall.minutesHelp',
          'Time without provider output before an open turn is marked. Chats are checked every 5 minutes.'
        )}
        labelId={labelId}
        control={
          <Select
            value={String(minutes)}
            onValueChange={(value) => updateSettings({ forkChatStallMinutes: Number(value) })}
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={labelId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {choice === 0
                    ? translate('fork.chatStall.off', 'Off')
                    : formatMinutesDuration(choice, intlLocale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsSwitchRow
        label={translate('fork.chatStall.autoLabel', 'Release long-stalled chats')}
        description={translate(
          'fork.chatStall.autoHelp',
          'After twice that time, release a stalled chat whose provider is stopped or gone. A chat whose provider is still running is only marked, since it may be in a long tool.'
        )}
        checked={autoRelease}
        disabled={minutes === 0}
        onChange={() => updateSettings({ forkChatStallAutoRelease: !autoRelease })}
      />
    </section>
  )
}
