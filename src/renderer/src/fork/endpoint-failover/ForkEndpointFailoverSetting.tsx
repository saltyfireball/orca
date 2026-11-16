// Endpoint failover (SLRM-2267, FORK.md) settings. On by default; main reads them on every check,
// so a change takes effect within seconds, with no restart.
import React, { useId } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  FORK_ENDPOINT_RETRY_SECOND_CHOICES,
  forkEndpointFailoverEnabled,
  forkEndpointFailoverRetrySeconds,
  forkEndpointLearnAddresses
} from '../../../../shared/fork/endpoint-failover'
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
import { useTranslate, type Translate } from '@/i18n/use-translate'

type ForkEndpointFailoverSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function retryLabel(seconds: number, t: Translate): string {
  return seconds < 60
    ? t('fork.endpointFailover.seconds', '{{count}} seconds', { count: seconds })
    : t('fork.endpointFailover.minutes', '{{count}} min', { count: seconds / 60 })
}

export function ForkEndpointFailoverSetting({
  settings,
  updateSettings
}: ForkEndpointFailoverSettingProps): React.JSX.Element {
  const t = useTranslate()
  const labelId = useId()
  const enabled = forkEndpointFailoverEnabled(settings)
  const learn = forkEndpointLearnAddresses(settings)
  const retry = forkEndpointFailoverRetrySeconds(settings)
  // Keep a hand-edited value selectable rather than showing a blank trigger.
  const choices = FORK_ENDPOINT_RETRY_SECOND_CHOICES.includes(retry)
    ? FORK_ENDPOINT_RETRY_SECOND_CHOICES
    : [...FORK_ENDPOINT_RETRY_SECOND_CHOICES, retry]
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.endpointFailover.title', 'Server routes')}
        description={t(
          'fork.endpointFailover.description',
          'Reach a remote server on another of its addresses (LAN, Tailscale, the saved one) when the one in use stops answering, and move back to the better one when it answers again. Terminals and chats keep running on the server through a move.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.endpointFailover.label', 'Switch routes automatically')}
        description={t(
          'fork.endpointFailover.help',
          'Routes are tried LAN first, then Tailscale, then any other address.'
        )}
        checked={enabled}
        onChange={() => updateSettings({ forkEndpointFailover: !enabled })}
      />
      <SettingsRow
        label={t('fork.endpointFailover.retryLabel', 'Try a better route every')}
        description={t(
          'fork.endpointFailover.retryHelp',
          'How often a better route is tried while a worse one is in use.'
        )}
        labelId={labelId}
        control={
          <Select
            value={String(retry)}
            disabled={!enabled}
            onValueChange={(value) =>
              updateSettings({ forkEndpointFailoverRetrySeconds: Number(value) })
            }
          >
            <SelectTrigger size="sm" className="min-w-32" aria-labelledby={labelId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {retryLabel(choice, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingsSwitchRow
        label={t('fork.endpointFailover.learnLabel', 'Learn server addresses')}
        description={t(
          'fork.endpointFailover.learnHelp',
          'Ask a Blackfish server for its current LAN and Tailscale addresses, so a changed address is still found. Stock Orca servers do not report them.'
        )}
        checked={learn}
        disabled={!enabled}
        onChange={() => updateSettings({ forkEndpointLearnAddresses: !learn })}
      />
    </section>
  )
}
