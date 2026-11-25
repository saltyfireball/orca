// Bot room hop limit (BAD-801, FORK.md "Bot room hop limit"): how many bot-to-bot hand-offs may
// chain under one post in a group room before the room waits for a Continue in the Decision inbox.
import React, { useId } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  FORK_BOT_ROOM_HOP_CHOICES,
  forkBotRoomHopLimit
} from '../../../../shared/fork/bot-room-hops'
import {
  SettingsRow,
  SettingsSubsectionHeader
} from '../../components/settings/form-controls/SettingsFormControls'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkBotRoomHopsSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const limitId = useId()
  const limit = forkBotRoomHopLimit(settings)
  const choices: readonly number[] = FORK_BOT_ROOM_HOP_CHOICES.some((choice) => choice === limit)
    ? FORK_BOT_ROOM_HOP_CHOICES
    : [...FORK_BOT_ROOM_HOP_CHOICES, limit].sort((a, b) => a - b)
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.botRoomHops.settings.title', 'Bot room hop limit')}
        description={t(
          'fork.botRoomHops.settings.description',
          'In a group room, a bot that names another as @Name wakes it. Past this many hand-offs under one post, nobody else is woken and the Decision inbox asks you to Continue. A new post of yours starts a new count.'
        )}
      />
      <SettingsRow
        label={t('fork.botRoomHops.limitLabel', 'Hand-offs before the room waits')}
        labelId={limitId}
        control={
          <Select
            value={String(limit)}
            onValueChange={(value) => updateSettings({ forkBotRoomHopLimit: Number(value) })}
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={limitId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {choice === 0 ? t('fork.botRoomHops.noLimit', 'No limit') : String(choice)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </section>
  )
}
