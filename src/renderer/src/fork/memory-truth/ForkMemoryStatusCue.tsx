// SLRM-2099: a warning mark beside the resource badge while system memory is past the threshold.
import { AlertTriangle } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import type { Translate } from '@/i18n/use-translate'
import { formatForkBytes, type ForkMemoryStatus } from '../../../../shared/fork/memory-truth'
import { useForkMemoryStatus } from './memory-status'

export function forkMemoryCueLines(status: ForkMemoryStatus, t: Translate): string[] {
  const lines = [t('fork.memory.cue.title', 'Memory is running low')]
  for (const reason of status.reasons) {
    lines.push(
      reason === 'pressure'
        ? t('fork.memory.reason.pressure', 'Memory pressure is {{level}}.', {
            level: status.system?.pressure ?? 'unknown'
          })
        : t('fork.memory.reason.swap', '{{swap}} of swap in use.', {
            swap: formatForkBytes(status.system?.swapUsed ?? 0)
          })
    )
  }
  if (status.launchesPaused) {
    lines.push(t('fork.memory.paused', 'New agents are paused until memory frees up.'))
  }
  return lines
}

export function ForkMemoryStatusCue({
  t,
  onOpen
}: {
  t: Translate
  onOpen: () => void
}): React.JSX.Element | null {
  const status = useForkMemoryStatus()
  if (!status?.over) {
    return null
  }
  const lines = forkMemoryCueLines(status, t)
  const severe = status.launchesPaused || status.system?.pressure === 'critical'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={lines.join(' ')}
          onClick={onOpen}
          className="inline-flex items-center rounded px-0.5 py-0.5 hover:bg-accent/70"
        >
          <AlertTriangle
            className={cn('size-3', severe ? 'text-destructive' : 'text-yellow-500')}
            aria-hidden="true"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </TooltipContent>
    </Tooltip>
  )
}
