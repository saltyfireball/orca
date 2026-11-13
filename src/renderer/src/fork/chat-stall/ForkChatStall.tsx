// Chat stall (FORK.md) in the renderer: a stalled chat's tab and sidebar row show an amber mark
// that opens Interrupt, Release and (for a stopped provider) Wake. Nothing renders for a chat that
// is not stalled, so detection turned off in settings leaves no trace here.
import React from 'react'
import { Hourglass } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { ForkChatStallAction, ForkChatStallEntry } from '../../../../shared/fork/chat-stall'
import { useForkChatStallEntry } from './chat-stall-store'
import { chatSessionIdForPaneKey, chatStallCanWake, chatStallQuietMinutes } from './chat-stall-view'

function stallLabel(entry: ForkChatStallEntry): string {
  const count = chatStallQuietMinutes(entry, Date.now())
  switch (entry.liveness) {
    case 'alive':
      return translate(
        'fork.chatStall.alive',
        'No output for {{count}} min. The provider is still running and may be in a long tool.',
        { count }
      )
    case 'stopped':
      return translate(
        'fork.chatStall.stopped',
        'No output for {{count}} min. The provider is stopped (suspended).',
        { count }
      )
    case 'gone':
      return translate(
        'fork.chatStall.gone',
        'No output for {{count}} min. The provider process is gone.',
        { count }
      )
    default:
      return translate(
        'fork.chatStall.unknown',
        'No output for {{count}} min. The provider process could not be checked.',
        { count }
      )
  }
}

function run(sessionId: string, action: ForkChatStallAction): void {
  void window.api.forkChatStall?.act(sessionId, action).catch(() => false)
}

const stop = (event: React.SyntheticEvent): void => event.stopPropagation()

function StallMenu({
  entry,
  trigger
}: {
  entry: ForkChatStallEntry
  trigger: React.ReactElement
}): React.JSX.Element {
  const label = stallLabel(entry)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild title={label} onClick={stop} onPointerDown={stop}>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={stop} className="max-w-72">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => run(entry.sessionId, 'interrupt')}>
          {translate('fork.chatStall.interrupt', 'Interrupt the turn')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run(entry.sessionId, 'release')}>
          {translate('fork.chatStall.release', 'Release the provider')}
        </DropdownMenuItem>
        {chatStallCanWake(entry) ? (
          <DropdownMenuItem onSelect={() => run(entry.sessionId, 'wake')}>
            {translate('fork.chatStall.wake', 'Wake the provider')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A chat tab's mark, after its title. */
export function ForkChatStallTabMark({
  sessionId
}: {
  sessionId: string | undefined
}): React.JSX.Element | null {
  const entry = useForkChatStallEntry(sessionId)
  if (!entry) {
    return null
  }
  return (
    <StallMenu
      entry={entry}
      trigger={
        <button type="button" className="mr-1 inline-flex shrink-0" data-fork-chat-stalled="">
          <Hourglass className="size-3 text-status-warning" aria-label={stallLabel(entry)} />
        </button>
      }
    />
  )
}

type RowSubject = { paneKey: string; tab: { worktreeId: string }; rowSource?: string }

/** A dashboard or worktree card agent row's mark. */
export function ForkChatStallRowMark({ agent }: { agent: RowSubject }): React.JSX.Element | null {
  const sessionId = useAppStore((s) =>
    agent.rowSource === 'subagent'
      ? null
      : chatSessionIdForPaneKey(s.unifiedTabsByWorktree[agent.tab.worktreeId], agent.paneKey)
  )
  const entry = useForkChatStallEntry(sessionId)
  if (!entry) {
    return null
  }
  return (
    <StallMenu
      entry={entry}
      trigger={
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[11px] text-status-warning-text hover:bg-status-warning-background"
          data-fork-chat-stalled=""
        >
          <Hourglass className="size-[11px]" aria-hidden />
          {translate('fork.chatStall.mark', 'Stalled')}
        </button>
      }
    />
  )
}
