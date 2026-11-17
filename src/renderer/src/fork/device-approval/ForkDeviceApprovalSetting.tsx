// SLRM-2271 (FORK.md "Device approval"): the switch for this computer, and the paired devices of
// this computer or of a paired server, to approve, deny or remove. Also `orca devices`.
import React, { useCallback, useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import {
  forkDeviceApprovalEnabled,
  type ForkDeviceListResult,
  type ForkPairedDevice
} from '../../../../shared/fork/device-approval'
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

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const LOCAL = 'local'
const CALL_TIMEOUT_MS = 15_000

function targetOf(hostId: string): RuntimeClientTarget {
  return hostId === LOCAL ? { kind: 'local' } : { kind: 'environment', environmentId: hostId }
}

function DeviceRow({
  device,
  busy,
  onAction
}: {
  device: ForkPairedDevice
  busy: boolean
  onAction: (method: string, target: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const status: Record<ForkPairedDevice['status'], string> = {
    approved: t('fork.deviceApproval.status.approved', 'Approved'),
    waiting: t('fork.deviceApproval.status.waiting', 'Waiting, code {{code}}', {
      code: device.code ?? ''
    }),
    'unused-link': t('fork.deviceApproval.status.unused', 'Pairing link not used yet'),
    'not-approved': t('fork.deviceApproval.status.notApproved', 'Not approved')
  }
  const kind =
    device.scope === 'mobile'
      ? t('fork.deviceApproval.phone', 'Phone')
      : t('fork.deviceApproval.desktop', 'Desktop')
  return (
    <SettingsRow
      label={device.name}
      description={`${kind} - ${status[device.status]}`}
      control={
        <div className="flex gap-2">
          {device.status === 'waiting' ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onAction('fork.devices.approve', device.deviceId)}
              >
                {t('fork.deviceApproval.approve', 'Approve')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onAction('fork.devices.deny', device.deviceId)}
              >
                {t('fork.deviceApproval.deny', 'Deny')}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onAction('fork.devices.revoke', device.deviceId)}
            >
              {t('fork.deviceApproval.remove', 'Remove')}
            </Button>
          )}
        </div>
      }
    />
  )
}

export function ForkDeviceApprovalSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const labelId = useId()
  const environments = useAppStore((s) => s.runtimeEnvironments) ?? []
  const enabled = forkDeviceApprovalEnabled(settings)
  const [hostId, setHostId] = useState(LOCAL)
  const [list, setList] = useState<ForkDeviceListResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      setList(
        await callRuntimeRpc<ForkDeviceListResult>(
          targetOf(hostId),
          'fork.devices.list',
          {},
          { timeoutMs: CALL_TIMEOUT_MS }
        )
      )
      setError(null)
    } catch (caught) {
      setList(null)
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [hostId])

  useEffect(() => {
    void refresh()
  }, [refresh, enabled])

  const act = async (method: string, target: string): Promise<void> => {
    setBusy(true)
    try {
      await callRuntimeRpc(targetOf(hostId), method, { target }, { timeoutMs: CALL_TIMEOUT_MS })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
    await refresh()
  }

  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.deviceApproval.title', 'Device approval')}
        description={t(
          'fork.deviceApproval.description',
          'A device that pairs with this computer waits until you approve it here, on an approved device, or with `orca devices approve <code>`. It shows its approval code; check that it matches. Devices paired before this was turned on stay approved.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.deviceApproval.label', 'Approve new devices')}
        description={t(
          'fork.deviceApproval.help',
          'Off by default. For a server, run `orca settings set forkDeviceApproval true` on it or with --environment.'
        )}
        checked={enabled}
        onChange={() => updateSettings({ forkDeviceApproval: !enabled })}
      />
      <SettingsRow
        label={t('fork.deviceApproval.host', 'Devices paired with')}
        labelId={labelId}
        description={
          error ??
          (list && !list.enabled && hostId !== LOCAL
            ? t('fork.deviceApproval.offThere', 'Approval is off on that host.')
            : undefined)
        }
        control={
          <div className="flex gap-2">
            <Select value={hostId} onValueChange={setHostId}>
              <SelectTrigger size="sm" className="min-w-40" aria-labelledby={labelId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={LOCAL}>
                  {t('fork.deviceApproval.thisComputer', 'This computer')}
                </SelectItem>
                {environments.map((environment) => (
                  <SelectItem key={environment.id} value={environment.id}>
                    {environment.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}>
              {t('fork.deviceApproval.refresh', 'Refresh')}
            </Button>
          </div>
        }
      />
      {list && list.devices.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('fork.deviceApproval.none', 'No paired devices.')}
        </p>
      ) : null}
      {list?.devices.map((device) => (
        <DeviceRow
          key={device.deviceId}
          device={device}
          busy={busy}
          onAction={(method, target) => void act(method, target)}
        />
      ))}
    </section>
  )
}
