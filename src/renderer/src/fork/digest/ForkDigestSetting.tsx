// Digest (SLRM-2388, FORK.md): the daily digest switch, its hour, its targets and the pull request
// lookup, plus a button that shows the digest now. The webhook address and command are the
// Decision inbox's, shown here too as on the Server health card. Main reads the settings every
// minute, so a change takes effect without a restart.
import React, { useId } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { FORK_DIGEST_HOUR_CHOICES, readForkDigestConfig } from '../../../../shared/fork/digest'
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
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { getIntlLocale } from '@/i18n/i18n'
import { ForkTextSetting } from '../idle-recovery/ForkTextSetting'
import { openForkDigest } from './use-fork-digest'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function hourLabel(hour: number): string {
  const at = new Date()
  at.setHours(hour, 0, 0, 0)
  return at.toLocaleTimeString(getIntlLocale(), { hour: 'numeric', minute: '2-digit' })
}

export function ForkDigestSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const hourId = useId()
  const config = readForkDigestConfig(settings)
  const off = !config.enabled
  const hasUrl = Boolean(settings.forkInboxNotifyWebhookUrl?.trim())
  const hasCommand = Boolean(settings.forkInboxNotifyCommand?.trim())
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.digest.settings.title', 'Digest')}
        description={t(
          'fork.digest.settings.description',
          'One summary across this desktop and every paired server: orchestration tasks that finished or failed, your pull requests merged or still open, the estimated cost, and the chats waiting on you. Also `orca digest`.'
        )}
      />
      <SettingsRow
        label={t('fork.digest.settings.showLabel', 'Show the digest')}
        description={t(
          'fork.digest.settings.showHelp',
          'Since the last daily digest, or the last day. Sends nothing.'
        )}
        control={
          <Button size="sm" variant="outline" onClick={openForkDigest}>
            {t('fork.digest.settings.show', 'Show')}
          </Button>
        }
      />
      <SettingsSwitchRow
        label={t('fork.digest.settings.dailyLabel', 'Send a daily digest')}
        description={t(
          'fork.digest.settings.dailyHelp',
          'Once a day, covering the time since the last one, to the targets below. If the app is not running at that hour, it goes out when the app next runs that day.'
        )}
        checked={config.enabled}
        onChange={() => updateSettings({ forkDigest: off })}
      />
      <SettingsRow
        label={t('fork.digest.settings.hourLabel', 'Send at')}
        description={t('fork.digest.settings.hourHelp', 'Local time on this computer.')}
        labelId={hourId}
        control={
          <Select
            value={String(config.hour)}
            disabled={off}
            onValueChange={(value) => updateSettings({ forkDigestHour: Number(value) })}
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={hourId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORK_DIGEST_HOUR_CHOICES.map((hour) => (
                <SelectItem key={hour} value={String(hour)}>
                  {hourLabel(hour)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsSwitchRow
        label={t('fork.digest.settings.desktopLabel', 'Desktop notification')}
        description={t(
          'fork.digest.settings.desktopHelp',
          'Follows the Decision inbox notification until set here.'
        )}
        checked={config.desktop}
        disabled={off}
        onChange={() => updateSettings({ forkDigestDesktop: !config.desktop })}
      />
      <SettingsSwitchRow
        label={t('fork.digest.settings.webhookLabel', 'Post to the notification webhook')}
        description={t(
          'fork.digest.settings.webhookHelp',
          "JSON with event digest, the totals, each machine's part and the same text as orca digest."
        )}
        checked={config.webhookUrl !== null}
        disabled={off || !hasUrl}
        onChange={() => updateSettings({ forkDigestWebhook: config.webhookUrl === null })}
      />
      <SettingsSwitchRow
        label={t('fork.digest.settings.commandLabel', 'Run the notification command')}
        description={t(
          'fork.digest.settings.commandHelp',
          'The same JSON on standard input. Only this screen can turn it on.'
        )}
        checked={config.command !== null}
        disabled={off || !hasCommand}
        onChange={() => updateSettings({ forkDigestCommand: config.command === null })}
      />
      <SettingsSwitchRow
        label={t('fork.digest.settings.prLabel', 'Read pull requests')}
        description={t(
          'fork.digest.settings.prHelp',
          'Asks the GitHub CLI (gh) for your pull requests in each project on each machine. Off: the digest leaves them out.'
        )}
        checked={config.pullRequests}
        onChange={() => updateSettings({ forkDigestPullRequests: !config.pullRequests })}
      />
      <ForkTextSetting
        settings={settings}
        updateSettings={updateSettings}
        settingKey="forkInboxNotifyWebhookUrl"
        label={t('fork.idleRecovery.webhookLabel', 'Notification webhook')}
        description={t(
          'fork.serverHealth.sharedWebhookHelp',
          'Shared with the Decision inbox: an http or https address that gets a POST. Empty: none.'
        )}
        disabled={off}
      />
      <ForkTextSetting
        settings={settings}
        updateSettings={updateSettings}
        settingKey="forkInboxNotifyCommand"
        label={t('fork.idleRecovery.notifyCommandLabel', 'Notification command')}
        description={t(
          'fork.serverHealth.sharedCommandHelp',
          'Shared with the Decision inbox: runs with your rights, the JSON on standard input. Empty: none.'
        )}
        disabled={off}
      />
    </section>
  )
}
