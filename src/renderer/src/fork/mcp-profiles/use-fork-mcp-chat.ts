// FORK.md "MCP profiles": a chat's MCP profile, read from the main process. Read again
// when settings change and every few seconds while shown and the window is visible, so a
// restart's servers show up.
import { useCallback, useEffect, useState } from 'react'
import type { ForkMcpChatInfo } from '../../../../shared/fork/mcp-profiles'
import { useAppStore } from '@/store'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'

const REFRESH_MS = 10_000

export function useForkMcpChat(sessionId: string | undefined): {
  chat: ForkMcpChatInfo | null
  choose: (profile: string | null) => void
} {
  const bridge = window.api.forkMcpProfiles
  const settings = useAppStore((s) => s.settings)
  const [chat, setChat] = useState<ForkMcpChatInfo | null>(null)
  useEffect(() => {
    if (!bridge || !sessionId) {
      setChat(null)
      return
    }
    let live = true
    const read = (): void => {
      void bridge
        .chat(sessionId)
        .then((next) => live && setChat(next))
        .catch(() => live && setChat(null))
    }
    // Reads now, then every REFRESH_MS while the window is visible (and again when it shows).
    const stop = installWindowVisibilityInterval({ run: read, intervalMs: REFRESH_MS })
    return () => {
      live = false
      stop()
    }
  }, [bridge, sessionId, settings])
  const choose = useCallback(
    (profile: string | null) => {
      if (bridge && sessionId) {
        void bridge.setChat(sessionId, profile).then(setChat, () => undefined)
      }
    },
    [bridge, sessionId]
  )
  return { chat, choose }
}
