// Pause all (BAD-685, FORK.md "Pause all"): the status bar's panic button. One click pauses (or
// resumes) every unattended feature here and on paired servers; running turns finish.
import { useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { toast } from 'sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isPairedWebClientWindow } from '@/app-shell/chrome/desktop-window-chrome'
import { useTranslate } from '@/i18n/use-translate'
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from '@/components/status-bar/composition/status-bar-context-menu-policy'
import type { ForkPauseAllResult } from '../../../../shared/fork/pause-all'
import { useForkPauseAllState, useForkPauseAllToggle } from './use-fork-pause-all'

/** Names the paired servers that did not take the change, or null when all did. */
export function pauseAllMissedServers(result: ForkPauseAllResult): string | null {
  const missed = result.hosts.filter((host) => host.status !== 'applied')
  return missed.length > 0 ? missed.map((host) => host.name).join(', ') : null
}

export function ForkPauseAllStatusSegment(): React.JSX.Element | null {
  const t = useTranslate()
  const state = useForkPauseAllState()
  const toggle = useForkPauseAllToggle()
  const [busy, setBusy] = useState(false)
  if (isPairedWebClientWindow() || state === null) {
    return null
  }
  const engaged = state.engaged
  const label = engaged
    ? t('fork.pauseAll.statusBar.resume', 'Paused: click to resume')
    : t('fork.pauseAll.statusBar.pause', 'Pause all unattended work')
  const detail = engaged
    ? t(
        'fork.pauseAll.statusBar.resumeDetail',
        'Automations, idle-recovery wakes, the PR babysitter, resumes and worker launches start nothing. Running turns finish. Click to resume here and on paired servers.'
      )
    : t(
        'fork.pauseAll.statusBar.pauseDetail',
        'Stops automations, idle-recovery wakes, the PR babysitter, resumes and worker launches from starting anything new, here and on paired servers. Running turns finish.'
      )
  const onClick = (): void => {
    setBusy(true)
    void toggle(!engaged)
      .then((result) => {
        const missed = pauseAllMissedServers(result)
        if (missed) {
          toast.error(
            t(
              'fork.pauseAll.statusBar.missed',
              'Could not reach or change: {{servers}}. Run orca pause-status to check them.',
              { servers: missed }
            )
          )
        }
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error))
      )
      .finally(() => setBusy(false))
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
          disabled={busy}
          onClick={onClick}
          aria-label={label}
          aria-pressed={engaged}
          className={`inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-accent/70 disabled:opacity-60 ${
            engaged
              ? 'bg-destructive/15 text-destructive'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {engaged ? <Play className="size-3" /> : <Pause className="size-3" />}
          {engaged ? (
            <span className="text-[11px] font-medium">
              {t('fork.pauseAll.statusBar.pausedLabel', 'Paused')}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {detail}
      </TooltipContent>
    </Tooltip>
  )
}
