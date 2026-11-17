// Boundary compaction (FORK.md) in the renderer. The reporter tells main which native chats hold
// text in their message box, so a chat someone is writing to is never compacted. The mark labels
// the transcript row of a compaction the app asked for, so it does not read as the user's own.
// The reporter does nothing while the mode is off and limit resume does not hold for drafts.
import React, { useEffect } from 'react'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import {
  boundaryCompactionEnabled,
  isForkBoundaryCompactionMessageId
} from '../../../../shared/fork/boundary-compaction'
import { limitResumeWatchesDrafts } from '../../../../shared/fork/limit-resume'
import { hydrateNativeChatComposerDrafts } from '@/components/native-chat/drafts/native-chat-composer-draft-load'
import {
  readNativeChatComposerDraft,
  subscribeToNativeChatComposerDraft
} from '@/components/native-chat/drafts/native-chat-composer-draft-store'
import { structuredAgentSessionDraftScopeKey } from '@/components/native-chat/drafts/native-chat-draft-scope'
import { nativeChatSessionIds, typedChatSessionIds } from './boundary-compaction-view'

/** Mounted once at the app root. Sends the list of chats with a draft whenever it changes. */
export function ForkBoundaryCompactionReporter(): null {
  // A joined string, so only a real change in the chat list re-subscribes. Null while off.
  const joined = useAppStore((s) =>
    // SLRM-2309: limit resume holds a chat whose message box has text, from the same report.
    boundaryCompactionEnabled(s.settings) || limitResumeWatchesDrafts(s.settings)
      ? nativeChatSessionIds(s.unifiedTabsByWorktree).join('\n')
      : null
  )
  useEffect(() => {
    if (joined === null) {
      return
    }
    const sessionIds = joined ? joined.split('\n') : []
    let stopped = false
    let sent: string | null = null
    const unsubscribes: (() => void)[] = []
    const report = (): void => {
      if (stopped) {
        return
      }
      const typed = typedChatSessionIds(sessionIds, (sessionId) =>
        readNativeChatComposerDraft(structuredAgentSessionDraftScopeKey(sessionId))
      )
      const next = typed.join('\n')
      if (next !== sent) {
        sent = next
        window.api.forkBoundaryCompaction?.setTyped(typed)
      }
    }
    // Saved drafts are read from storage once at start-up. Until they are in memory an empty
    // message box proves nothing, and main leaves every chat alone until the first report.
    void hydrateNativeChatComposerDrafts().then(() => {
      if (stopped) {
        return
      }
      for (const sessionId of sessionIds) {
        unsubscribes.push(
          subscribeToNativeChatComposerDraft(structuredAgentSessionDraftScopeKey(sessionId), report)
        )
      }
      report()
    })
    return () => {
      stopped = true
      for (const unsubscribe of unsubscribes) {
        unsubscribe()
      }
    }
  }, [joined])
  return null
}

/** Under the "/compact" row of a compaction the app asked for; nothing on any other row. */
export function ForkBoundaryCompactionMark({
  messageId
}: {
  messageId: string
}): React.JSX.Element | null {
  const t = useTranslate()
  if (!isForkBoundaryCompactionMessageId(messageId)) {
    return null
  }
  return (
    <div className="text-xs text-chat-foreground-faint" data-fork-boundary-compaction="">
      {t('fork.boundaryCompaction.mark', 'Automatic compaction between turns')}
    </div>
  )
}
