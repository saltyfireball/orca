// Boundary compaction (FORK.md): what the renderer knows. Main decides when a chat compacts; the
// renderer only reports which native chats hold text in their message box, because a draft lives
// in the window and main cannot read it.
import type { Tab } from '../../../../shared/tab-types'

/**
 * The session ids of every native chat tab in every workspace, sorted, so equal sets compare
 * equal as strings. A chat with no tab has no message box to type in.
 */
export function nativeChatSessionIds(
  unifiedTabsByWorktree: Record<string, readonly Tab[] | undefined> | undefined
): string[] {
  const ids = new Set<string>()
  for (const tabs of Object.values(unifiedTabsByWorktree ?? {})) {
    for (const tab of tabs ?? []) {
      if (tab.contentType === 'agent-session' && tab.entityId) {
        ids.add(tab.entityId)
      }
    }
  }
  return [...ids].sort()
}

/** True when a message box holds something the user would lose sight of: text or an image. */
export function isTypedDraft(draft: {
  text: string
  images: readonly unknown[] | undefined
}): boolean {
  return draft.text.trim().length > 0 || (draft.images?.length ?? 0) > 0
}

/** The chats among `sessionIds` whose draft, as `read` gives it, is not empty. */
export function typedChatSessionIds(
  sessionIds: readonly string[],
  read: (sessionId: string) => { text: string; images: readonly unknown[] | undefined }
): string[] {
  return sessionIds.filter((sessionId) => isTypedDraft(read(sessionId)))
}
