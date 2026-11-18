// Agent guards (FORK.md, SLRM-2385) in the renderer: a short status line after a guarded chat's or
// terminal agent's tab title and on its sidebar agent row, in the muted text the row already
// uses ("loop warned", "guard paused"). Nothing renders for an agent no guard acted on.
import React from 'react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { agentGuardReasonText, type AgentGuardEntry } from '../../../../shared/fork/agent-guards'
import { useForkAgentGuardEntry } from './agent-guards-store'

function label(entry: AgentGuardEntry, t: Translate): string {
  if (entry.state === 'warned') {
    return t('fork.agentGuards.markWarned', 'loop warned')
  }
  return entry.reason === 'spend'
    ? t('fork.agentGuards.markSpend', 'paused: spend cap')
    : t('fork.agentGuards.markLoop', 'paused: failure loop')
}

function hint(entry: AgentGuardEntry, t: Translate): string {
  const why = agentGuardReasonText(entry)
  if (entry.state === 'warned') {
    return why
  }
  return t(
    'fork.agentGuards.pausedHint',
    '{{why}} Answer it in the Decision inbox, or run: orca guards resume {{id}}',
    { why, id: entry.id }
  )
}

function Mark({
  entry,
  className
}: {
  entry: AgentGuardEntry | null
  className: string
}): React.JSX.Element | null {
  const t = useTranslate()
  if (!entry) {
    return null
  }
  return (
    <span className={className} title={hint(entry, t)} data-fork-agent-guard={entry.state}>
      {label(entry, t)}
    </span>
  )
}

/** After a tab's title: a native chat by session id, a terminal tab by any of its panes. */
export function ForkAgentGuardTabMark({
  tabId,
  sessionId
}: {
  tabId: string
  sessionId: string | undefined
}): React.JSX.Element | null {
  const entry = useForkAgentGuardEntry(sessionId ? { sessionId } : { tabId })
  return <Mark entry={entry} className="mr-1 shrink-0 text-[11px] text-muted-foreground" />
}

/** A dashboard or worktree card agent row. */
export function ForkAgentGuardRowMark({
  agent
}: {
  agent: { paneKey: string }
}): React.JSX.Element | null {
  const entry = useForkAgentGuardEntry({ paneKey: agent.paneKey })
  return (
    <Mark
      entry={entry}
      className="inline-flex shrink-0 items-center px-1 text-[11px] text-muted-foreground"
    />
  )
}
