// Limit resume (FORK.md, SLRM-2309) in the renderer: a short "resumes at HH:MM" label after a
// parked chat's or terminal agent's tab title and on its sidebar agent row, in the muted text the
// row already uses. Nothing renders for anything not parked, so the feature turned off leaves no
// trace here.
import React from 'react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { formatLimitResumeClock, type LimitResumeEntry } from '../../../../shared/fork/limit-resume'
import { useForkLimitResumeEntry } from './limit-resume-store'

function label(entry: LimitResumeEntry, t: Translate): string {
  return t('fork.limitResume.mark', 'resumes at {{time}}', {
    time: formatLimitResumeClock(entry.resumeAt, Date.now())
  })
}

function hint(entry: LimitResumeEntry, t: Translate): string {
  if (entry.state === 'held') {
    return t(
      'fork.limitResume.heldHint',
      'Stopped on a usage limit. Its time came, but its message box has text, so it waits.'
    )
  }
  return entry.resetsAt === null
    ? t(
        'fork.limitResume.backoffHint',
        'Stopped on a usage limit with no reset time given; it is tried again after a wait.'
      )
    : t('fork.limitResume.resetHint', 'Stopped on a usage limit; it goes on once the limit resets.')
}

/** After a tab's title: a native chat by session id, a terminal tab by any of its panes. */
export function ForkLimitResumeTabMark({
  tabId,
  sessionId
}: {
  tabId: string
  sessionId: string | undefined
}): React.JSX.Element | null {
  const t = useTranslate()
  const entry = useForkLimitResumeEntry(sessionId ? { sessionId } : { tabId })
  if (!entry) {
    return null
  }
  return (
    <span
      className="mr-1 shrink-0 text-[11px] text-muted-foreground"
      title={hint(entry, t)}
      data-fork-limit-resume=""
    >
      {label(entry, t)}
    </span>
  )
}

/** A dashboard or worktree card agent row. */
export function ForkLimitResumeRowMark({
  agent
}: {
  agent: { paneKey: string }
}): React.JSX.Element | null {
  const t = useTranslate()
  const entry = useForkLimitResumeEntry({ paneKey: agent.paneKey })
  if (!entry) {
    return null
  }
  return (
    <span
      className="inline-flex shrink-0 items-center px-1 text-[11px] text-muted-foreground"
      title={hint(entry, t)}
      data-fork-limit-resume=""
    >
      {label(entry, t)}
    </span>
  )
}
