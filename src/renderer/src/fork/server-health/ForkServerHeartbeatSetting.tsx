// Server heartbeat (SLRM-2311, FORK.md): the address this host calls every few seconds so an
// outside monitor sees it is alive. Off until an address is set. For a server, set it there with
// `orca settings set forkServerHeartbeatUrl <url> --environment <name>`.
import React, { useId } from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  FORK_SERVER_HEARTBEAT_SECOND_CHOICES,
  readForkServerHeartbeatConfig,
  FORK_SERVER_HEARTBEAT_DEFAULT_SECONDS
} from '../../../../shared/fork/server-health'
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
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { ForkTextSetting } from '../idle-recovery/ForkTextSetting'

const METHODS = ['GET', 'POST'] as const

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function everyLabel(seconds: number, t: Translate): string {
  return seconds < 60
    ? t('fork.serverHeartbeat.seconds', '{{count}} seconds', { count: seconds })
    : t('fork.serverHeartbeat.minutes', '{{count}} min', { count: seconds / 60 })
}

export function ForkServerHeartbeatSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const everyId = useId()
  const methodId = useId()
  const config = readForkServerHeartbeatConfig(settings)
  const off = config.state !== 'on'
  const seconds =
    config.state === 'on' ? config.intervalMs / 1000 : FORK_SERVER_HEARTBEAT_DEFAULT_SECONDS
  const choices = FORK_SERVER_HEARTBEAT_SECOND_CHOICES.includes(seconds)
    ? FORK_SERVER_HEARTBEAT_SECOND_CHOICES
    : [...FORK_SERVER_HEARTBEAT_SECOND_CHOICES, seconds]
  const method = settings.forkServerHeartbeatMethod === 'POST' ? 'POST' : 'GET'
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.serverHeartbeat.title', 'Heartbeat')}
        description={t(
          'fork.serverHeartbeat.description',
          'This host calls an address of your monitor (healthchecks, n8n, Home Assistant) every few seconds, so the monitor notices when the host stops, even while no desktop is awake. Nothing about the host is sent. For a server, run `orca settings set forkServerHeartbeatUrl <url> --environment <name>`.'
        )}
      />
      <ForkTextSetting
        settings={settings}
        updateSettings={updateSettings}
        settingKey="forkServerHeartbeatUrl"
        label={t('fork.serverHeartbeat.urlLabel', 'Heartbeat address')}
        description={
          config.state === 'invalid'
            ? t(
                'fork.serverHeartbeat.invalid',
                'Not an http or https address (or it has a user or password in it): the heartbeat is off.'
              )
            : t('fork.serverHeartbeat.urlHelp', 'An http or https address. Empty: off.')
        }
        disabled={false}
      />
      <SettingsRow
        label={t('fork.serverHeartbeat.everyLabel', 'Call it every')}
        labelId={everyId}
        control={
          <Select
            value={String(seconds)}
            disabled={off}
            onValueChange={(value) => updateSettings({ forkServerHeartbeatSeconds: Number(value) })}
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={everyId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {everyLabel(choice, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsRow
        label={t('fork.serverHeartbeat.methodLabel', 'Method')}
        labelId={methodId}
        control={
          <Select
            value={method}
            disabled={off}
            onValueChange={(value) =>
              updateSettings({ forkServerHeartbeatMethod: value === 'POST' ? 'POST' : 'GET' })
            }
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={methodId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </section>
  )
}
