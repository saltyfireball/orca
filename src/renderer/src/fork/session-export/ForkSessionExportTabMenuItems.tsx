// Session export (FORK.md, BAD-688): "Copy chat as Markdown" in a native chat tab's right-click
// menu. Stock hook in SortableTabContextMenu.tsx. Writing a file or sharing a link is
// `orca agent export`, a separate and explicit step.
import { useState } from 'react'
import { FileText } from 'lucide-react'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { forkClaudeChatTarget } from '../claude-account-move/fork-claude-move-actions'
import { copyChatAsMarkdown } from './session-export-client'

export function ForkSessionExportTabMenuItems({
  worktreeId,
  sessionId
}: {
  worktreeId: string
  sessionId: string
}): React.JSX.Element | null {
  const t = useTranslate()
  // Read once per menu open, like the tab's other session items.
  const [target] = useState(() =>
    forkClaudeChatTarget(useAppStore.getState(), worktreeId, sessionId)
  )
  if (!target) {
    return null
  }
  return (
    <ContextMenuItem
      onSelect={() => void copyChatAsMarkdown(target, sessionId, useAppStore.getState().settings)}
    >
      <FileText className="size-3.5 shrink-0" />
      {t('fork.sessionExport.menu', 'Copy chat as Markdown')}
    </ContextMenuItem>
  )
}
