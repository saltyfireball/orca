// Worker retry policy (BAD-681, FORK.md): the "Retry" line of a crew row's details. The worker
// that ended says whether Orca waits to restart it (and when), restarted it or gave up, with the
// try number and why it ended; the restarted worker says which retry it is.
import { translate } from '@/i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { ForkCrewRetryState } from '../../../../shared/fork/worker-retry-crew'

function clock(iso: string | undefined): string {
  const at = iso ? new Date(iso) : null
  return at && Number.isFinite(at.getTime())
    ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '-'
}

export function forkCrewRetryText(retry: ForkCrewRetryState, t: Translate = translate): string {
  const n = { count: retry.attempt }
  if (retry.side === 'restart') {
    return t('fork.workerRetry.crew.isRetry', 'Retry {{count}}, started after: {{reason}}', {
      ...n,
      reason: retry.reason
    })
  }
  switch (retry.state) {
    case 'waiting':
      return t(
        'fork.workerRetry.crew.waiting',
        'Retry {{count}} waits until {{time}}: {{reason}}',
        {
          ...n,
          time: clock(retry.dueAt),
          reason: retry.reason
        }
      )
    case 'restarted':
      return t('fork.workerRetry.crew.restarted', 'Restarted as retry {{count}}: {{reason}}', {
        ...n,
        reason: retry.reason
      })
    case 'gave-up':
      return t(
        'fork.workerRetry.crew.gaveUp',
        'Gave up at retry {{count}} ({{detail}}): {{reason}}',
        { ...n, detail: retry.detail ?? '-', reason: retry.reason }
      )
  }
}

export function ForkCrewRetryDetail({ retry }: { retry: ForkCrewRetryState | undefined }) {
  const t = useTranslate()
  if (!retry) {
    return null
  }
  return (
    <>
      <dt className="text-2xs text-muted-foreground">
        {t('fork.workerRetry.crew.label', 'Retry')}
      </dt>
      <dd
        className={cn(
          'min-w-0 [overflow-wrap:anywhere]',
          retry.state === 'gave-up' && retry.side === 'ended' && 'text-destructive'
        )}
        data-retry-state={retry.state}
      >
        {forkCrewRetryText(retry, t)}
      </dd>
    </>
  )
}
