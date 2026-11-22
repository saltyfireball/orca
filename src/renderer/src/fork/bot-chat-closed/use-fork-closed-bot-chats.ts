// Closed bot chats in the Chats tab (FORK.md "Auto-close finished bot chats", BAD-734). The host's chat
// list leaves closed chats out; this pages them in on request, newest activity first.
import { useCallback, useEffect, useRef, useState } from 'react'
import { callBotRpc } from '@/lib/bot-hosts'
import type { Bot } from '../../../../shared/bot-types'
import type { BotChatTreeChat } from '../../../../shared/bots/bot-chat-tree'
import {
  FORK_BOT_CHAT_OLDER_METHOD,
  type ForkBotChatOlderResult
} from '../../../../shared/fork/bot-chat-list-filter'

export type ForkClosedBotChats = {
  /** The closed chats read so far; empty while hidden. */
  chats: BotChatTreeChat[]
  shown: boolean
  loading: boolean
  /** Closed chats the host has beyond the ones read. */
  more: boolean
  /** How many closed chats the host left out of the list. */
  total: number
  toggle: () => void
  loadMore: () => void
}

/** `total` is the host's closedTotal from the chat list: a change reads the first page again. */
export function useForkClosedBotChats(bot: Bot, total: number): ForkClosedBotChats {
  const [shown, setShown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [read, setRead] = useState<{ chats: BotChatTreeChat[]; more: boolean }>({
    chats: [],
    more: false
  })
  const generation = useRef(0)
  const { hostId, id: botId } = bot

  const fetchPage = useCallback(
    (before: number | undefined, base: BotChatTreeChat[]) => {
      const mine = ++generation.current
      setLoading(true)
      void callBotRpc<ForkBotChatOlderResult>({ hostId }, FORK_BOT_CHAT_OLDER_METHOD, {
        botId,
        ...(before !== undefined ? { before } : {})
      })
        .then((page) => {
          if (mine === generation.current) {
            setRead({ chats: [...base, ...page.chats], more: page.more })
          }
        })
        .catch((error: unknown) => console.error('Failed to read closed bot chats:', error))
        .finally(() => {
          if (mine === generation.current) {
            setLoading(false)
          }
        })
    },
    [hostId, botId]
  )

  useEffect(() => {
    if (shown) {
      fetchPage(undefined, [])
    }
  }, [shown, total, fetchPage])

  const loadMore = useCallback(() => {
    const last = read.chats.at(-1)
    if (last && read.more && !loading) {
      fetchPage(last.lastActiveAt, read.chats)
    }
  }, [read, loading, fetchPage])

  return {
    chats: shown ? read.chats : [],
    shown,
    loading,
    more: shown && read.more,
    total,
    toggle: () => setShown((current) => !current),
    loadMore
  }
}
