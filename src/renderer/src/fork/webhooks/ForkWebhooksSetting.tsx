// SLRM-2271 (FORK.md "Webhook automations"): the listener's switch, address and port on this
// computer, and its webhooks. Adding one prints a secret once, so that stays in `orca webhooks add`.
import React, { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  resolveForkWebhookSettings,
  type ForkWebhookListResult,
  type ForkWebhookSettings
} from '../../../../shared/fork/webhooks'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { ForkNumberInput } from '../cache-cold/ForkNumberInput'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const LOCAL = { kind: 'local' } as const

export function ForkWebhooksSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const resolved = resolveForkWebhookSettings(settings.forkWebhooks)
  const [list, setList] = useState<ForkWebhookListResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bindDraft, setBindDraft] = useState<string | null>(null)
  const update = (patch: ForkWebhookSettings): void =>
    updateSettings({ forkWebhooks: { ...settings.forkWebhooks, ...patch } })

  const refresh = useCallback(async () => {
    try {
      setList(await callRuntimeRpc<ForkWebhookListResult>(LOCAL, 'fork.webhooks.list', {}))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [])

  useEffect(() => {
    // The listener follows settings within a few seconds; ask again once it has.
    const timer = setTimeout(() => void refresh(), 6_000)
    void refresh()
    return () => clearTimeout(timer)
  }, [refresh, resolved.enabled, resolved.bindHost, resolved.port])

  const remove = async (id: string): Promise<void> => {
    try {
      await callRuntimeRpc(LOCAL, 'fork.webhooks.remove', { target: id })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
    await refresh()
  }

  const bindLabel = t('fork.webhooks.bind', 'Listen on address')
  const portLabel = t('fork.webhooks.port', 'Port')
  const status = error
    ? error
    : list?.listening
      ? t('fork.webhooks.listening', 'Listening on {{address}}.', { address: list.listening })
      : (list?.error ?? undefined)
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.webhooks.title', 'Webhooks')}
        description={t(
          'fork.webhooks.description',
          'Let an outside service, such as a failed CI run, start an automation on this computer. Each webhook has its own secret and every request must be signed with it (HMAC-SHA256, as GitHub sends it). The payload reaches the agent marked as untrusted. Add one with `orca webhooks add`.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.webhooks.label', 'Accept webhooks')}
        description={status ?? t('fork.webhooks.help', 'Off by default.')}
        checked={resolved.enabled}
        onChange={() => update({ enabled: !resolved.enabled })}
      />
      <SettingsRow
        label={bindLabel}
        description={t(
          'fork.webhooks.bindHelp',
          '127.0.0.1 takes requests from this computer only. Use an address the sender can reach, such as the Tailscale address of this computer, or put a reverse proxy in front.'
        )}
        control={
          <Input
            variant="code"
            className="w-40"
            aria-label={bindLabel}
            value={bindDraft ?? resolved.bindHost}
            onChange={(event) => setBindDraft(event.target.value)}
            onBlur={() => {
              if (bindDraft !== null && bindDraft.trim()) {
                update({ bindHost: bindDraft.trim() })
              }
              setBindDraft(null)
            }}
          />
        }
      />
      <SettingsRow
        label={portLabel}
        control={
          <ForkNumberInput
            value={resolved.port}
            label={portLabel}
            min={1024}
            max={65_535}
            onCommit={(port) => update({ port })}
          />
        }
      />
      {list?.hooks.map((hook) => (
        <SettingsRow
          key={hook.id}
          label={hook.name}
          description={`${hook.automationName ?? hook.automationId} - ${hook.url}${
            hook.lastDelivery ? ` - ${hook.lastDelivery.result}` : ''
          }`}
          control={
            <Button size="sm" variant="ghost" onClick={() => void remove(hook.id)}>
              {t('fork.webhooks.remove', 'Remove')}
            </Button>
          }
        />
      ))}
    </section>
  )
}
