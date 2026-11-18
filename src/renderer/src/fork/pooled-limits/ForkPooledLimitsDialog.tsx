// Pooled limits (FORK.md, SLRM-2392): what /usage-limits in a chat opens. Mounted once at the app
// root through ForkRootHosts. Same rows as the usage popover's pooled section, every provider and
// each account with the machines it was seen on.
import React, { useEffect, useSyncExternalStore } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/index'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { normalizeUsagePercentageDisplay } from '../../../../shared/agent-usage/display/usage-percentage-display'
import type { PooledMachine } from '../../../../shared/fork/pooled-limits'
import { loadForkPooledLimits, useForkPooledLimits } from './use-fork-pooled-limits'
import {
  ForkPooledLimitsList,
  forkPooledMachinesAnswered,
  useForkPooledLimitsEnabled
} from './ForkPooledLimitsRoster'

let open = false
const listeners = new Set<() => void>()

function setOpen(next: boolean): void {
  open = next
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function openForkPooledLimitsDialog(): void {
  setOpen(true)
}

function machineText(machine: PooledMachine, t: Translate): string {
  switch (machine.status) {
    case 'ok':
      return t('fork.pooledLimits.machineOk', '{{name}} ({{count}})', {
        name: machine.name,
        count: machine.accounts
      })
    case 'off':
      return t('fork.pooledLimits.machineOff', '{{name}} (pooled limits off)', {
        name: machine.name
      })
    case 'no-probe':
      return t('fork.pooledLimits.machineStock', '{{name}} (not Blackfish)', { name: machine.name })
    case 'unreachable':
      return t('fork.pooledLimits.machineUnreachable', '{{name}} (not answering)', {
        name: machine.name
      })
  }
}

function Body(): React.JSX.Element {
  const t = useTranslate()
  const enabled = useForkPooledLimitsEnabled()
  const display = normalizeUsagePercentageDisplay(useAppStore((s) => s.usagePercentageDisplay))
  const { result, loading, error, reload } = useForkPooledLimits(enabled)
  useEffect(() => {
    if (enabled) {
      void loadForkPooledLimits({ force: true })
    }
  }, [enabled])
  if (!enabled || result?.off) {
    return (
      <p className="text-sm text-muted-foreground">
        {t(
          'fork.pooledLimits.off',
          'Pooled limits are off. Turn them on in Settings > Blackfish > Usage and accounts.'
        )}
      </p>
    )
  }
  return (
    <div className="space-y-3">
      {result && result.providers.length > 0 ? (
        <div className="rounded-md border border-border text-xs">
          <ForkPooledLimitsList
            rows={result.providers}
            machines={forkPooledMachinesAnswered(result)}
            display={display}
            detailed
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {loading
            ? t('fork.pooledLimits.loading', 'Asking each machine...')
            : t('fork.pooledLimits.none', 'No Claude or Codex account found.')}
        </p>
      )}
      {result ? (
        <p className="text-[11px] text-muted-foreground">
          {t('fork.pooledLimits.machineList', 'Machines: {{list}}', {
            list: result.machines.map((machine) => machineText(machine, t)).join(', ')
          })}
        </p>
      ) : null}
      {error ? (
        <p className="text-[11px] text-destructive">
          {t('fork.pooledLimits.error', 'Could not read pooled limits.')}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" disabled={loading} onClick={reload}>
          <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
          {t('fork.pooledLimits.refresh', 'Read again')}
        </Button>
      </div>
    </div>
  )
}

export function ForkPooledLimitsDialogHost(): React.JSX.Element {
  const t = useTranslate()
  const isOpen = useSyncExternalStore(subscribe, () => open)
  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t('fork.pooledLimits.dialogTitle', 'Usage limits, all machines')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'fork.pooledLimits.dialogDescription',
              'Every Claude and Codex account on this machine and its paired servers, each counted once.'
            )}
          </DialogDescription>
        </DialogHeader>
        {isOpen ? <Body /> : null}
      </DialogContent>
    </Dialog>
  )
}
