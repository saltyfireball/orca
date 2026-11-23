// What of the bot's chats waits on the owner, for `useBotNow` (FORK.md "Needs you list", BAD-795).
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { selectFolderWorkspaces } from '@/store/workspaces/catalog/workspace-record-fields'
import { buildWorktreeAgentRows } from '@/components/sidebar/workspace-card/activity/worktree-agent-rows'
import { selectLiveAgentStatusEntriesForWorktree } from '@/components/sidebar/workspace-card/activity/worktree-agent-row-selectors'
import { useBotOwnChats } from '@/lib/bot-own-chats'
import { useNow } from '@/lib/window-activity/use-now'
import type { Bot } from '../../../../shared/bot-types'
import type { AgentStatusEntry } from '../../../../shared/agent-status/contracts/agent-status-types'
import { folderWorkspaceKey } from '../../../../shared/workspace/identity/workspace-scope'
import {
  forkBotWaitingChats,
  type ForkBotWaitingChats,
  type ForkBotWaitingChatsInput
} from '../../../../shared/fork/bot-waiting-chats'

const NO_ENTRIES: AgentStatusEntry[] = []

/** The same agent rows the bot's sidebar row reads, those that ask; none while it is paused. */
function useAskingEntries(bot: Bot | null): readonly AgentStatusEntry[] {
  const read = bot && !bot.paused ? bot : null
  const chats = useBotOwnChats(read)
  const folderWorkspaceId = read?.folderWorkspaceId ?? null
  const links = useAppStore((s) =>
    folderWorkspaceId === null
      ? undefined
      : selectFolderWorkspaces(s).find((workspace) => workspace.id === folderWorkspaceId)
          ?.externalConversations
  )
  const paneKeys = useMemo(
    () => [
      ...(links ?? []).map((link) => link.paneKey),
      ...(chats ?? []).map((chat) => chat.paneKey)
    ],
    [links, chats]
  )
  const own = useAppStore(
    useShallow((s) => paneKeys.flatMap((paneKey) => s.agentStatusByPaneKey.get(paneKey) ?? []))
  )
  const home = useAppStore((s) =>
    folderWorkspaceId === null
      ? NO_ENTRIES
      : selectLiveAgentStatusEntriesForWorktree(s, folderWorkspaceKey(folderWorkspaceId))
  )
  const now = useNow(60_000)
  return useMemo(() => {
    const ownKeys = new Set(own.map((entry) => entry.paneKey))
    const entries = [...own, ...home.filter((entry) => !ownKeys.has(entry.paneKey))]
    if (!entries.some((entry) => entry.state === 'blocked' || entry.state === 'waiting')) {
      return NO_ENTRIES
    }
    return buildWorktreeAgentRows({ tabs: [], entries, now }).flatMap((row) =>
      row.rowSource !== 'subagent' && (row.state === 'blocked' || row.state === 'waiting')
        ? [row.entry]
        : []
    )
  }, [own, home, now])
}

export function useForkBotWaitingChats(
  bot: Bot | null,
  input: Pick<ForkBotWaitingChatsInput, 'activity' | 'chats' | 'waitingSideChats'>
): ForkBotWaitingChats {
  const asking = useAskingEntries(bot)
  const chatSessionId = bot?.chatSessionId ?? null
  const folderWorkspaceId = bot?.folderWorkspaceId ?? ''
  const { activity, chats, waitingSideChats } = input
  return useMemo(
    () =>
      forkBotWaitingChats({
        asking,
        chatSessionId,
        homeWorkspaceId: folderWorkspaceKey(folderWorkspaceId),
        activity,
        chats,
        waitingSideChats
      }),
    [asking, chatSessionId, folderWorkspaceId, activity, chats, waitingSideChats]
  )
}
