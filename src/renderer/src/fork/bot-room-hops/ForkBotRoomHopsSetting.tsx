// Bot room hop limit (BAD-801, FORK.md "Bot room hop limit"): how many bot-to-bot hand-offs may
// chain under one post in a group room before the room waits for a Continue in the Decision inbox,
// and (BAD-844) how many turns they may wake under it in all.
import React, { useId } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  FORK_BOT_ROOM_HOP_CHOICES,
  FORK_BOT_ROOM_TURN_CHOICES,
  forkBotRoomHopLimit,
  forkBotRoomTurnCap
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

function LimitRow({
  label,
  value,
  choices,
  noneLabel,
  onChange
}: {
  label: string
  value: number
  choices: readonly number[]
  noneLabel: string
  onChange: (value: number) => void
}): React.JSX.Element {
  const labelId = useId()
  // A stored value that is not a choice still shows as itself.
  const shown = choices.includes(value) ? choices : [...choices, value].sort((a, b) => a - b)
  return (
    <SettingsRow
      label={label}
      labelId={labelId}
      control={
        <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
          <SelectTrigger size="sm" className="min-w-32" aria-labelledby={labelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {shown.map((choice) => (
              <SelectItem key={choice} value={String(choice)}>
                {choice === 0 ? noneLabel : String(choice)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  )
}

export function ForkBotRoomHopsSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.botRoomHops.settings.title', 'Bot room hop limit')}
        description={t(
          'fork.botRoomHops.settings.turnsDescription',
          'In a group room, a bot that names another as @Name wakes it. Past this many hand-offs in one chain, or this many woken turns in all, under one post, nobody else is woken and the Decision inbox asks you to Continue. A new post of yours starts a new count.'
        )}
      />
      <LimitRow
        label={t('fork.botRoomHops.limitLabel', 'Hand-offs before the room waits')}
        value={forkBotRoomHopLimit(settings)}
        choices={FORK_BOT_ROOM_HOP_CHOICES}
        noneLabel={t('fork.botRoomHops.noLimit', 'No limit')}
        onChange={(value) => updateSettings({ forkBotRoomHopLimit: value })}
      />
      <LimitRow
        label={t('fork.botRoomHops.turnCapLabel', 'Woken turns before the room waits')}
        value={forkBotRoomTurnCap(settings)}
        choices={FORK_BOT_ROOM_TURN_CHOICES}
        noneLabel={t('fork.botRoomHops.noLimit', 'No limit')}
        onChange={(value) => updateSettings({ forkBotRoomTurnCap: value })}
      />
    </section>
  )
}
