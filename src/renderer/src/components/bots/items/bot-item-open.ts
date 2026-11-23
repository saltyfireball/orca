// Opening an item from outside the panel (a chat's item chip): that bot's Items tab shows it. The ask
// names its bot and is taken once, by that bot's panel, however often panels remount.
import { useEffect, useSyncExternalStore } from 'react'
import { botRefKey, type BotRef } from '@/lib/bot-hosts'
import { useAppStore } from '@/store'

// Fork (BAD-759): a null uid asks the panel to leave its open item for the list.
type Request = { bot: string; uid: string | null }

let request: Request | null = null
const listeners = new Set<() => void>()

function announce(): void {
  listeners.forEach((listener) => listener())
}

export function openBotItem(bot: BotRef, uid: string): void {
  request = { bot: botRefKey(bot), uid }
  useAppStore.getState().setRightSidebarTab('bot-activity')
  useAppStore.getState().setRightSidebarOpen(true)
  announce()
}

/** Fork (BAD-759): shows the bot's Home list; a panel inside an item goes back to it. */
export function closeBotItem(bot: BotRef): void {
  request = { bot: botRefKey(bot), uid: null }
  useAppStore.getState().setRightSidebarTab('bot-activity')
  useAppStore.getState().setRightSidebarOpen(true)
  announce()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Takes the ask for an item of `bot`, once, and hands its uid to `open`. */
export function useBotItemOpenRequest(
  bot: BotRef,
  open: (uid: string) => void,
  close?: () => void
): void {
  const pending = useSyncExternalStore(subscribe, () => request)
  const key = botRefKey(bot)
  useEffect(() => {
    if (pending && pending.bot === key && request === pending) {
      request = null
      announce()
      if (pending.uid === null) {
        close?.()
      } else {
        open(pending.uid)
      }
    }
  }, [pending, key, open, close])
}
