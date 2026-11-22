// Bot row badges and colors (FORK.md "Bot row badges and colors") settings. On by default: the
// badges only add counts the row already knows. Colors are set per bot from its context menu.
import React, { useId } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { forkBotRowBadgesEnabled } from '../../../../shared/fork/bot-row-badges'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { Button } from '../../components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { FORK_BOT_CHAT_RECENT_DEFAULT_MINUTES } from '../../../../shared/fork/bot-chat-listing'
import {
  FORK_BOT_CHAT_AUTO_CLOSE_DEFAULT_GRACE_MINUTES,
  FORK_BOT_CHAT_AUTO_CLOSE_DEFAULT_IDLE_HOURS,
  FORK_BOT_CHAT_AUTO_CLOSE_GRACE_CHOICES,
  FORK_BOT_CHAT_AUTO_CLOSE_IDLE_CHOICES,
  forkBotChatAutoCloseEnabled
} from '../../../../shared/fork/bot-chat-auto-close'
import { formatMinutesDuration } from '@/i18n/ui-intl-formatters'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const RECENT_CHOICES = [0, 15, 60, 240, 1440]

export function ForkBotRowBadgesSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const enabled = forkBotRowBadgesEnabled(settings)
  const intlLocale = useIntlLocale()
  const recentId = useId()
  const recent = settings.forkBotChatRecentMinutes ?? FORK_BOT_CHAT_RECENT_DEFAULT_MINUTES
  const recentChoices = RECENT_CHOICES.includes(recent)
    ? RECENT_CHOICES
    : [...RECENT_CHOICES, recent].sort((a, b) => a - b)
  const autoClose = forkBotChatAutoCloseEnabled(settings)
  const idleHours =
    settings.forkBotChatAutoCloseIdleHours ?? FORK_BOT_CHAT_AUTO_CLOSE_DEFAULT_IDLE_HOURS
  const graceMinutes =
    settings.forkBotChatAutoCloseGraceMinutes ?? FORK_BOT_CHAT_AUTO_CLOSE_DEFAULT_GRACE_MINUTES
  const idleId = useId()
  const graceId = useId()
  const withCurrent = (choices: readonly number[], current: number): readonly number[] =>
    choices.includes(current) ? choices : [...choices, current].sort((a, b) => a - b)
  const colored = Object.keys(settings.forkBotRowColors ?? {}).length
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.botRowBadges.title', 'Bot row badges and colors')}
        description={t(
          'fork.botRowBadges.description',
          'Show how many items need you and how many are working on each bot row in the sidebar, dim a bot that is idle, and total what needs you on the folded Bots header. Right-click a bot to give its row a color.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.botRowBadges.label', 'Bot status badges')}
        checked={enabled}
        onChange={() => updateSettings({ forkBotRowBadges: !enabled })}
      />
      <SettingsRow
        label={t('fork.botRowBadges.colorsLabel', 'Bot colors')}
        description={t('fork.botRowBadges.colorsHelp', '{{count}} set', { count: colored })}
        control={
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={colored === 0}
            onClick={() => updateSettings({ forkBotRowColors: {} })}
          >
            {t('fork.botRowBadges.clearColors', 'Clear all')}
          </Button>
        }
      />
      <SettingsRow
        label={t('fork.botRowBadges.recentLabel', 'Keep chats without a tab listed for')}
        description={t(
          'fork.botRowBadges.recentHelp',
          'A bot chat nobody opened, such as one another bot started, stays listed under its bot this long after its last activity. A chat that is running or waiting on you always lists. None lists only chats with an open tab.'
        )}
        labelId={recentId}
        control={
          <Select
            value={String(recent)}
            onValueChange={(value) => updateSettings({ forkBotChatRecentMinutes: Number(value) })}
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={recentId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {recentChoices.map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {choice === 0
                    ? t('fork.botRowBadges.recentNone', 'None')
                    : formatMinutesDuration(choice, intlLocale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsSwitchRow
        label={t('fork.botChatAutoClose.label', 'Close finished bot chats')}
        description={t(
          'fork.botChatAutoClose.help',
          'A bot chat closes by itself, with its history kept in the bot\u2019s Chats tab, once it is idle and its card is done or canceled, a chat Orca started finished and reported back, or it has sat idle too long. Never a Home Chat, a chat that is running or waiting on you, or one you typed into recently. Mail for a closed chat reopens it.'
        )}
        checked={autoClose}
        onChange={() => updateSettings({ forkBotChatAutoClose: !autoClose })}
      />
      <SettingsRow
        label={t('fork.botChatAutoClose.idleLabel', 'Close idle chats after')}
        description={t(
          'fork.botChatAutoClose.idleHelp',
          'Time since the chat\u2019s last activity.'
        )}
        labelId={idleId}
        control={
          <Select
            value={String(idleHours)}
            disabled={!autoClose}
            onValueChange={(value) =>
              updateSettings({ forkBotChatAutoCloseIdleHours: Number(value) })
            }
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={idleId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {withCurrent(FORK_BOT_CHAT_AUTO_CLOSE_IDLE_CHOICES, idleHours).map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {formatMinutesDuration(choice * 60, intlLocale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsRow
        label={t('fork.botChatAutoClose.graceLabel', 'Keep a finished chat open for')}
        description={t(
          'fork.botChatAutoClose.graceHelp',
          'After a chat Orca started finishes, a quick follow-up can still land there. A follow-up restarts the wait.'
        )}
        labelId={graceId}
        control={
          <Select
            value={String(graceMinutes)}
            disabled={!autoClose}
            onValueChange={(value) =>
              updateSettings({ forkBotChatAutoCloseGraceMinutes: Number(value) })
            }
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={graceId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {withCurrent(FORK_BOT_CHAT_AUTO_CLOSE_GRACE_CHOICES, graceMinutes).map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {formatMinutesDuration(choice, intlLocale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </section>
  )
}
