// One line under the update state when the fork is behind upstream or its last sync failed
// (FORK.md "Sync status"). Informational: it never blocks a check, download or install.
import type React from 'react'
import { useIntlLocale } from '@/i18n/use-translate'
import { translate } from '@/i18n/i18n'
import { uiDateTimeFormat } from '@/i18n/ui-intl-formatters'
import { openAppHttpLinkFromAnchor } from '@/lib/browser/navigation/app-http-link-open'
import type { ForkSyncNotice } from '../../../../shared/fork/fork-sync-status'
import { useForkSyncNotice } from './use-fork-sync-status'

function headline(notice: ForkSyncNotice, since: string): string {
  const { status } = notice
  const upstream = status.upstreamVersion ?? '?'
  const base = status.forkBaseVersion ?? '?'
  switch (notice.kind) {
    case 'stale':
      return translate(
        'fork.syncStatus.stale',
        'The fork has not reported a sync for {{days}} days; its sync workflow may have stopped running.',
        { days: notice.staleDays ?? 0 }
      )
    case 'conflict':
      return translate(
        'fork.syncStatus.conflict',
        'This fork is still on upstream {{base}}; syncing to {{upstream}} hit conflicts in {{count}} files (since {{since}}).',
        { base, upstream, count: status.conflicts.length, since }
      )
    case 'behind':
      return translate(
        'fork.syncStatus.behind',
        'This fork is still on upstream {{base}}; upstream {{upstream}} is out (since {{since}}).',
        { base, upstream, since }
      )
    default:
      return translate('fork.syncStatus.error', 'The fork sync failed (since {{since}}).', {
        since
      })
  }
}

export function ForkSyncStatusNotice({
  updateState
}: {
  updateState: string
}): React.JSX.Element | null {
  const intlLocale = useIntlLocale()
  const notice = useForkSyncNotice(updateState)
  if (!notice) {
    return null
  }
  const when = notice.status.since ?? notice.status.checkedAt
  const since = uiDateTimeFormat({ dateStyle: 'medium' }, intlLocale).format(new Date(when))
  return (
    <p className="text-xs text-muted-foreground" role="status">
      {headline(notice, since)}
      {notice.kind !== 'stale' && notice.status.reason ? ` ${notice.status.reason}` : null}
      {notice.status.runUrl ? (
        <>
          {' '}
          <a
            href={notice.status.runUrl}
            target="_blank"
            onClick={openAppHttpLinkFromAnchor}
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            {translate('fork.syncStatus.viewRun', 'View sync run')}
          </a>
        </>
      ) : null}
    </p>
  )
}
