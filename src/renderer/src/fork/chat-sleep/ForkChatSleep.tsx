// Chat sleep (FORK.md) in the renderer. The reporter tells main which chats are on screen; the
// marks show a sleeping chat on its tab and sidebar row with the same moon the sleeping
// workspace uses. All of it renders nothing while the setting is off.
import React, { useEffect } from 'react'
import { Moon } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { forkChatSleepEnabled } from '../../../../shared/fork/chat-sleep'
import {
  chatPaneKeyForSession,
  isChatPaneKey,
  isSleepingChatStatus,
  onScreenChatSessionIds
} from './chat-sleep-view'

type ChatSleepState = Parameters<Parameters<typeof useAppStore>[0]>[0]

function enabled(s: ChatSleepState): boolean {
  return forkChatSleepEnabled(s.settings)
}

function sleepingLabel(): string {
  return translate('fork.chatSleep.sleeping', 'Sleeping. The next message wakes it.')
}

/** Mounted once at the app root. Sends the on-screen chat list whenever it changes. */
export function ForkChatSleepReporter(): null {
  // A joined string, so only a real change in the list re-renders and resends.
  const joined = useAppStore((s) =>
    enabled(s)
      ? onScreenChatSessionIds({
          activeWorktreeId: s.activeWorktreeId,
          groupsByWorktree: s.groupsByWorktree,
          unifiedTabsByWorktree: s.unifiedTabsByWorktree
        }).join('\n')
      : ''
  )
  useEffect(() => {
    window.api.forkChatSleep?.setOnScreen(joined ? joined.split('\n') : [])
  }, [joined])
  return null
}

/** True while this chat tab sleeps (and chat sleep is on). Shared with the state colors. */
export function useSleepingChatTab(worktreeId: string, sessionId: string | undefined): boolean {
  return useAppStore((s) => {
    if (!sessionId || !enabled(s)) {
      return false
    }
    const paneKey = chatPaneKeyForSession(s.unifiedTabsByWorktree[worktreeId], sessionId)
    return paneKey !== null && isSleepingChatStatus(s.agentStatusByPaneKey[paneKey])
  })
}

/** A chat tab's moon, after its title. */
export function ForkChatSleepTabMark({
  worktreeId,
  sessionId
}: {
  worktreeId: string
  sessionId: string | undefined
}): React.JSX.Element | null {
  if (!useSleepingChatTab(worktreeId, sessionId)) {
    return null
  }
  return (
    <span className="mr-1 inline-flex shrink-0" title={sleepingLabel()} data-fork-chat-sleeping="">
      <Moon className="size-3 text-muted-foreground" aria-label={sleepingLabel()} />
    </span>
  )
}

type RowSubject = { paneKey: string; tab: { worktreeId: string }; rowSource?: string }

/** True while this row's chat sleeps (and chat sleep is on). Shared with the state colors. */
export function useSleepingChatRow(agent: RowSubject): boolean {
  return useAppStore(
    (s) =>
      agent.rowSource !== 'subagent' &&
      enabled(s) &&
      isSleepingChatStatus(s.agentStatusByPaneKey[agent.paneKey]) &&
      isChatPaneKey(s.unifiedTabsByWorktree[agent.tab.worktreeId], agent.paneKey)
  )
}

/** A dashboard or worktree card agent row's moon. */
export function ForkChatSleepRowMark({ agent }: { agent: RowSubject }): React.JSX.Element | null {
  if (!useSleepingChatRow(agent)) {
    return null
  }
  return (
    <span className="inline-flex shrink-0" title={sleepingLabel()} data-fork-chat-sleeping="">
      <Moon className="size-[13px] text-muted-foreground" aria-label={sleepingLabel()} />
    </span>
  )
}

/** A compact row has no room for the moon, so it is dimmed. The parent must be `relative`. */
export function ForkChatSleepRowDim({ agent }: { agent: RowSubject }): React.JSX.Element | null {
  if (!useSleepingChatRow(agent)) {
    return null
  }
  return (
    <span
      aria-hidden
      data-fork-chat-sleeping=""
      className="pointer-events-none absolute inset-0 rounded-[inherit] bg-background/40"
    />
  )
}
