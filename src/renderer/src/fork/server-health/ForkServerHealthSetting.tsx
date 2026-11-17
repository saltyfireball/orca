// Server health (SLRM-2311, FORK.md): the switch, the offline time, the alert targets, and one
// status line per paired server. The webhook address and command are the Decision inbox's, shown
// here too so they can be set without turning idle recovery on. Main reads the settings on every
// reading, so a change takes effect within seconds, with no restart.
import React, { useEffect, useId, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  FORK_SERVER_HEALTH_LIST_METHOD,
  FORK_SERVER_HEALTH_OFFLINE_MINUTE_CHOICES,
  formatForkDuration,
  readForkServerHealthConfig,
  type ForkServerHealthEntry,
  type ForkServerHealthListResult
} from '../../../../shared/fork/server-health'
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
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { getIntlLocale } from '@/i18n/i18n'
import { ForkTextSetting } from '../idle-recovery/ForkTextSetting'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const REFRESH_MS = 10_000

function statusLine(entry: ForkServerHealthEntry, now: number, t: Translate): string {
  const seen = entry.lastSeenAt
    ? t('fork.serverHealth.lastSeen', 'last seen {{time}}', {
        time: new Date(entry.lastSeenAt).toLocaleTimeString(getIntlLocale())
      })
    : t('fork.serverHealth.notSeen', 'not seen since this app started')
  const since = entry.downSince === null ? '' : formatForkDuration(now - entry.downSince)
  switch (entry.state) {
    case 'up':
      return t('fork.serverHealth.up', 'Answering')
    case 'down':
      return t('fork.serverHealth.down', 'Not answering for {{since}}, {{seen}}', { since, seen })
    case 'offline':
      return t('fork.serverHealth.offline', 'Offline for {{since}}, {{seen}}', { since, seen })
    case 'recovering':
      return t('fork.serverHealth.recovering', 'Answering again after {{since}} down', { since })
    case 'unwatched':
      return t('fork.serverHealth.unwatched', 'Not watched: this desktop is not connected to it')
  }
}

function ServerStatusList({ enabled }: { enabled: boolean }): React.JSX.Element | null {
  const t = useTranslate()
  const [loaded, setLoaded] = useState<{ list: ForkServerHealthListResult; at: number } | null>(
    null
  )
  useEffect(() => {
    if (!enabled) {
      setLoaded(null)
      return
    }
    let live = true
    const load = (): void => {
      callRuntimeRpc<ForkServerHealthListResult>(
        { kind: 'local' },
        FORK_SERVER_HEALTH_LIST_METHOD,
        {},
        { timeoutMs: REFRESH_MS }
      )
        .then((list) => live && setLoaded({ list, at: Date.now() }))
        .catch(() => live && setLoaded(null))
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [enabled])
  if (!enabled || !loaded) {
    return null
  }
  const { list, at: now } = loaded
  if (list.servers.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('fork.serverHealth.none', 'No paired remote servers yet.')}
      </p>
    )
  }
  return (
    <>
      {list.servers.map((entry) => (
        <SettingsRow
          key={entry.environmentId}
          label={entry.name}
          description={statusLine(entry, now, t)}
          control={null}
        />
      ))}
    </>
  )
}

export function ForkServerHealthSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const minutesId = useId()
  const config = readForkServerHealthConfig(settings)
  const off = !config.enabled
  const minutes = Math.round(config.offlineMs / 60_000)
  const choices = FORK_SERVER_HEALTH_OFFLINE_MINUTE_CHOICES.includes(minutes)
    ? FORK_SERVER_HEALTH_OFFLINE_MINUTE_CHOICES
    : [...FORK_SERVER_HEALTH_OFFLINE_MINUTE_CHOICES, minutes]
  const hasUrl = Boolean(settings.forkInboxNotifyWebhookUrl?.trim())
  const hasCommand = Boolean(settings.forkInboxNotifyCommand?.trim())
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.serverHealth.title', 'Server health')}
        description={t(
          'fork.serverHealth.description',
          'Say once when a paired remote server stops answering, and once when it is back, with how long it was down. A server that flaps does not alert again until it has answered for a minute. Also `orca servers health`.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.serverHealth.label', 'Watch paired servers')}
        description={t(
          'fork.serverHealth.help',
          "Uses this desktop's own connection to each server; nothing extra is sent."
        )}
        checked={config.enabled}
        onChange={() => updateSettings({ forkServerHealth: off })}
      />
      <SettingsRow
        label={t('fork.serverHealth.minutesLabel', 'Alert after')}
        description={t(
          'fork.serverHealth.minutesHelp',
          'How long a server must stay unreachable before the offline alert.'
        )}
        labelId={minutesId}
        control={
          <Select
            value={String(minutes)}
            disabled={off}
            onValueChange={(value) =>
              updateSettings({ forkServerHealthOfflineMinutes: Number(value) })
            }
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={minutesId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {t('fork.serverHealth.minutes', '{{count}} min', { count: choice })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsSwitchRow
        label={t('fork.serverHealth.desktopLabel', 'Desktop notification')}
        description={t(
          'fork.serverHealth.desktopHelp',
          'Follows the Decision inbox notification until set here.'
        )}
        checked={config.alertDesktop}
        disabled={off}
        onChange={() => updateSettings({ forkServerHealthAlertDesktop: !config.alertDesktop })}
      />
      <SettingsSwitchRow
        label={t('fork.serverHealth.webhookLabel', 'Post to the notification webhook')}
        description={t(
          'fork.serverHealth.webhookHelp',
          'JSON with event server-offline or server-recovered, the server name and the times.'
        )}
        checked={config.webhookUrl !== null}
        disabled={off || !hasUrl}
        onChange={() =>
          updateSettings({ forkServerHealthAlertWebhook: config.webhookUrl === null })
        }
      />
      <SettingsSwitchRow
        label={t('fork.serverHealth.commandLabel', 'Run the notification command')}
        description={t(
          'fork.serverHealth.commandHelp',
          'The same JSON on standard input. Only this screen can turn it on.'
        )}
        checked={config.command !== null}
        disabled={off || !hasCommand}
        onChange={() => updateSettings({ forkServerHealthAlertCommand: config.command === null })}
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
      <ServerStatusList enabled={config.enabled} />
    </section>
  )
}
