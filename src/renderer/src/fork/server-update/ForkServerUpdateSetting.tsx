// Server updates (SLRM-2310, FORK.md): the paired servers with their versions, Update and Roll
// back for each, Update all that are behind, and the auto-update switch. Also `orca servers`.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import type {
  ForkServerRow,
  ForkServersListResult,
  ForkServersRunResult,
  ForkServersRunRow
} from '../../../../shared/fork/server-update-wire'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const LOCAL = { kind: 'local' } as const
const CALL_TIMEOUT_MS = 60_000
const POLL_MS = 3_000

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

function ServerRow({
  row,
  run,
  busy,
  onUpdate,
  onRollback
}: {
  row: ForkServerRow
  run: ForkServersRunRow | undefined
  busy: boolean
  onUpdate: () => void
  onRollback: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const status = row.status
  let state: string
  if (run && run.outcome !== 'pending') {
    state = `${run.outcome}${run.phase && run.outcome === 'running' ? ` (${run.phase})` : ''}${run.message ? `: ${run.message}` : ''}`
  } else if (row.error === 'unreachable') {
    state = t('fork.serverUpdate.unreachable', 'Not answering')
  } else if (!status) {
    state = t('fork.serverUpdate.noSupport', 'No server updates here; update it once by hand')
  } else if (!status.install) {
    state = status.problem ?? t('fork.serverUpdate.cannot', 'Cannot be updated from here')
  } else if (row.versus !== null && row.versus < 0) {
    state = t('fork.serverUpdate.behind', '{{version}}, behind', { version: status.version })
  } else {
    state = status.version
  }
  const canUpdate = Boolean(
    status?.install && status.accept && row.versus !== null && row.versus < 0
  )
  return (
    <SettingsRow
      label={row.name}
      description={state}
      control={
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy || !canUpdate} onClick={onUpdate}>
            {t('fork.serverUpdate.update', 'Update')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !status?.previousVersion || !status.accept}
            onClick={onRollback}
          >
            {t('fork.serverUpdate.rollback', 'Roll back')}
          </Button>
        </div>
      }
    />
  )
}

export function ForkServerUpdateSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const auto = settings.forkServerUpdateAuto === true
  const [list, setList] = useState<ForkServersListResult | null>(null)
  const [run, setRun] = useState<ForkServersRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setList(
        await callRuntimeRpc<ForkServersListResult>(
          LOCAL,
          'fork.servers.list',
          {},
          {
            timeoutMs: CALL_TIMEOUT_MS
          }
        )
      )
      setError(null)
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void refresh()
    return () => {
      alive.current = false
    }
  }, [refresh])

  const follow = async (started: ForkServersRunResult): Promise<void> => {
    let current = started
    setRun(current)
    while (!current.done && alive.current) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      current = await callRuntimeRpc<ForkServersRunResult>(
        LOCAL,
        'fork.servers.run',
        { runId: current.runId },
        { timeoutMs: CALL_TIMEOUT_MS }
      )
      setRun(current)
    }
    if (alive.current) {
      await refresh()
    }
  }

  const start = async (method: string, params: Record<string, unknown>): Promise<void> => {
    try {
      setError(null)
      await follow(
        await callRuntimeRpc<ForkServersRunResult>(LOCAL, method, params, {
          timeoutMs: CALL_TIMEOUT_MS
        })
      )
    } catch (caught) {
      setError(errorText(caught))
    }
  }

  const running = Boolean(run && !run.done)
  const behind = (list?.servers ?? []).filter(
    (row) => row.status?.install && row.status.accept && row.versus !== null && row.versus < 0
  )

  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.serverUpdate.title', 'Server updates')}
        description={t(
          'fork.serverUpdate.description',
          "Update paired servers to this desktop's version over their own connection, one at a time. Each one downloads its release, checks it, waits for its running turns, restarts, and keeps the old version to put back. Also `orca servers`."
        )}
      />
      <SettingsSwitchRow
        label={t('fork.serverUpdate.auto', 'Update servers when this desktop updates')}
        description={t(
          'fork.serverUpdate.autoHelp',
          'Off by default. Once this desktop starts on a new version, every paired server is updated to it.'
        )}
        checked={auto}
        onChange={() => updateSettings({ forkServerUpdateAuto: !auto })}
      />
      <SettingsRow
        label={t('fork.serverUpdate.thisDesktop', 'This desktop')}
        description={error ?? list?.version}
        control={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={running || behind.length === 0}
              onClick={() =>
                void start('fork.servers.update', { servers: behind.map((row) => row.id) })
              }
            >
              {t('fork.serverUpdate.updateBehind', 'Update all behind ({{count}})', {
                count: behind.length
              })}
            </Button>
            <Button size="sm" variant="ghost" disabled={loading} onClick={() => void refresh()}>
              {t('fork.serverUpdate.refresh', 'Refresh')}
            </Button>
          </div>
        }
      />
      {list && list.servers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('fork.serverUpdate.none', 'No paired servers.')}
        </p>
      ) : null}
      {list?.servers.map((row) => (
        <ServerRow
          key={row.id}
          row={row}
          run={run?.rows.find((entry) => entry.id === row.id)}
          busy={running}
          onUpdate={() => void start('fork.servers.update', { servers: [row.id] })}
          onRollback={() => void start('fork.servers.rollback', { server: row.id })}
        />
      ))}
    </section>
  )
}
