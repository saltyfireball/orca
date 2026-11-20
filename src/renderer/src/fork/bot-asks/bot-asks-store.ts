// Bot asks in the Decision inbox (FORK.md "Idle recovery", SLRM-2453): the one live copy of the
// items bots set to Needs you, across every listed host (this computer and its paired servers),
// shared by the inbox button, the dialog and the always-mounted watcher. It reads only bots whose
// host counts Needs you items for them (the count each host already sends with its bot list), and
// reads such a bot again when its items change or its count moves. Every read is reported to the
// main process, which tells the inbox's notify targets of each new ask once. With no reader, or
// with `forkInboxBotAsks` off or bots off, it holds, reads and reports nothing.
import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { botRefKey, callBotRpc } from '@/lib/bot-hosts'
import { onBotsChanged } from '@/lib/bots-changed-window-event'
import { readBots, readBotsEnabled, useBotsEnabled } from '@/lib/bot-catalog'
import { readBotItemsNeedingOwner, subscribeToBotChanges } from '@/lib/bot-catalog-snapshot'
import type { Bot } from '../../../../shared/bot-types'
import type { BotItemsListRead } from '../../../../shared/bots/bot-item-schema'
import { botChangeConcerns } from '../../../../shared/bots/bot-change-scope'
import {
  FORK_BOT_ASKS_MAX_REPORT,
  readForkInboxBotAsksSettings
} from '../../../../shared/fork/inbox-bot-asks'
import { findBotByWorkspace } from '@/components/bots/bot-workspace'
import {
  forkBotAskNotice,
  forkBotAsksOf,
  forkBotsWithAsks,
  type ForkBotAsk,
  type ForkBotItemsRead
} from './bot-asks-view'

export type ForkBotAsksSnapshot = { asks: readonly ForkBotAsk[] }

const EMPTY: ForkBotAsksSnapshot = { asks: [] }
/** Change notices come in bursts: reads start at most this often. */
const READ_GAP_MS = 500

type Held = { bot: Bot; count: number | null; items: ForkBotItemsRead['items'] }

let snapshot = EMPTY
const readers = new Set<() => void>()
let stop: (() => void) | null = null
let held = new Map<string, Held>()
const dirty = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null
let reading = false
let generation = 0
/** The open Decision inbox shows every ask, so a new one is on screen there. */
let inboxOpen = (): boolean => false

export function setForkBotAsksInboxOpenReader(read: () => boolean): void {
  inboxOpen = read
}

/** Bot asks are on: the setting and Settings > Bots > Enable bots. */
export function forkBotAsksEnabled(): boolean {
  return readForkInboxBotAsksSettings(useAppStore.getState().settings).enabled && readBotsEnabled()
}

export function useForkBotAsksEnabled(): boolean {
  const on = useAppStore((s) => readForkInboxBotAsksSettings(s.settings).enabled)
  return useBotsEnabled() && on
}

/** The asks as last read, without subscribing; empty with no reader. */
export function readForkBotAsks(): readonly ForkBotAsk[] {
  return snapshot.asks
}

function publish(): void {
  snapshot = { asks: forkBotAsksOf([...held.values()], Date.now()) }
  for (const reader of readers) {
    reader()
  }
  report()
}

/** Whether this window is focused and shows `bot`'s Home tab, where its asks are drawn. */
function botOnScreen(bot: Bot): boolean {
  if (typeof document === 'undefined' || !document.hasFocus()) {
    return false
  }
  if (inboxOpen()) {
    return true
  }
  const state = useAppStore.getState()
  if (!state.rightSidebarOpen || state.rightSidebarTab !== 'bot-activity') {
    return false
  }
  const shown = findBotByWorkspace(readBots(), state.activeWorktreeId)
  return shown !== null && botRefKey(shown) === botRefKey(bot)
}

function report(): void {
  const bridge = window.api?.forkIdleRecovery
  if (!bridge?.reportBotAsks) {
    return
  }
  const asks = snapshot.asks
    .slice(-FORK_BOT_ASKS_MAX_REPORT)
    .map((ask) => forkBotAskNotice(ask, botOnScreen(ask.bot)))
  void bridge.reportBotAsks({ asks }).catch((error: unknown) => {
    console.warn('[fork bot asks] report failed', error)
  })
}

/** Which bots to read: those counted now; a bot whose count moved, or never read, is read again. */
function reconcile(): void {
  const wanted = forkBotsWithAsks(readBots(), readBotItemsNeedingOwner)
  const next = new Map<string, Held>()
  for (const bot of wanted) {
    const key = botRefKey(bot)
    const count = readBotItemsNeedingOwner(bot)
    const before = held.get(key)
    next.set(key, { bot, count, items: before?.items ?? [] })
    if (!before || before.count !== count) {
      dirty.add(key)
    }
  }
  const dropped = held.size !== next.size || [...held.keys()].some((key) => !next.has(key))
  held = next
  for (const key of dirty) {
    if (!held.has(key)) {
      dirty.delete(key)
    }
  }
  if (dropped) {
    publish()
  }
  schedule()
}

function schedule(): void {
  if (timer || reading || dirty.size === 0) {
    return
  }
  timer = setTimeout(() => {
    timer = null
    void readDirty()
  }, READ_GAP_MS)
}

async function readDirty(): Promise<void> {
  const mine = generation
  const keys = [...dirty]
  dirty.clear()
  reading = true
  try {
    const results = await Promise.all(
      keys.map(async (key) => {
        const entry = held.get(key)
        if (!entry) {
          return false
        }
        try {
          const read = await callBotRpc<BotItemsListRead>(entry.bot, 'bots.items.owner.list', {
            botId: entry.bot.id
          })
          const now = held.get(key)
          if (mine !== generation || !now) {
            return false
          }
          held.set(key, { ...now, items: Array.isArray(read?.items) ? read.items : [] })
          return true
        } catch (error) {
          // The last good read stays: a host that did not answer never drops its asks.
          console.warn('[fork bot asks] reading the items of a bot failed', error)
          return false
        }
      })
    )
    if (mine === generation && results.some(Boolean)) {
      publish()
    }
  } finally {
    reading = false
    // Whatever generation: a reader that came back while this read ran left its own reads waiting.
    schedule()
  }
}

function start(): () => void {
  const offCatalog = subscribeToBotChanges(reconcile)
  const offChanged = onBotsChanged((hostId, scope) => {
    for (const [key, entry] of held) {
      if (
        entry.bot.hostId === hostId &&
        botChangeConcerns(scope, { botId: entry.bot.id, kinds: ['items'] })
      ) {
        dirty.add(key)
      }
    }
    schedule()
  })
  reconcile()
  return () => {
    offCatalog()
    offChanged()
  }
}

function subscribeLive(reader: () => void): () => void {
  readers.add(reader)
  if (readers.size === 1) {
    stop = start()
  }
  return () => {
    readers.delete(reader)
    if (readers.size === 0) {
      stop?.()
      stop = null
      generation += 1
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      held = new Map()
      dirty.clear()
      snapshot = EMPTY
    }
  }
}

function subscribeNothing(): () => void {
  return () => {}
}

/** The live asks while `enabled`; the empty snapshot, with nothing read, while not. */
export function useForkBotAsks(enabled: boolean): ForkBotAsksSnapshot {
  return useSyncExternalStore(enabled ? subscribeLive : subscribeNothing, () =>
    enabled ? snapshot : EMPTY
  )
}

/** Read the bots that have asks again now, as after an answer. */
export function refreshForkBotAsks(): void {
  for (const key of held.keys()) {
    dirty.add(key)
  }
  schedule()
}
