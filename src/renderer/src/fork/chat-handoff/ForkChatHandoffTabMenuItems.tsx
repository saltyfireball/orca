// Chat handoff (FORK.md, SLRM-2391): "Hand off to Codex" (or Claude) in a native chat tab's
// right-click menu. Stock hook in SortableTabContextMenu.tsx; gives nothing for other agents or
// while the setting is off.
import { useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import {
  chatHandoffAgentLabel,
  otherChatHandoffAgent,
  readChatHandoffSettings
} from '../../../../shared/fork/chat-handoff'
import { forkClaudeChatTarget } from '../claude-account-move/fork-claude-move-actions'
import { runChatHandoff } from './chat-handoff-client'

export function ForkChatHandoffTabMenuItems({
  worktreeId,
  chat
}: {
  worktreeId: string
  chat: { sessionId: string; agent?: string }
}): React.JSX.Element | null {
  const { sessionId } = chat
  const t = useTranslate()
  const enabled = useAppStore((s) => readChatHandoffSettings(s.settings).enabled)
  // Read once per menu open, like the tab's other session items.
  const [target] = useState(() =>
    forkClaudeChatTarget(useAppStore.getState(), worktreeId, sessionId)
  )
  const to = otherChatHandoffAgent(chat.agent ?? '')
  if (!enabled || !to || !target) {
    return null
  }
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => void runChatHandoff(target, { sessionId, to })}>
        <ArrowRightLeft className="size-3.5 shrink-0" />
        {t('fork.chatHandoff.menu', 'Hand off to {{agent}}', {
          agent: chatHandoffAgentLabel(to)
        })}
      </ContextMenuItem>
    </>
  )
}
