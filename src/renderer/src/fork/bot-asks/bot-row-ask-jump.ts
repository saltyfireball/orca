// Bot row click (FORK.md "Idle recovery", SLRM-2472, BAD-759): a click on a bot's sidebar row opens
// the bot as upstream does and, while the bot has items waiting on the owner (upstream's own count,
// the row's "N needs you"), by `forkBotRowAskJump`: 'list' shows its Home list with Needs you on top
// (a panel inside an item goes back to it), 'item' shows the first waiting item on its Home tab with
// its ask card in view, as the Decision inbox's Open does (SLRM-2453), and a click while that ask
// shows moves to the next. 'off', or nothing waiting: the click is upstream's alone.
import { useAppStore } from '@/store'
import { botRefKey, callBotRpc } from '@/lib/bot-hosts'
import { readBots } from '@/lib/bot-catalog'
import { readBotItemsNeedingOwner } from '@/lib/bot-catalog-snapshot'
import { findBotByWorkspace } from '@/components/bots/bot-workspace'
import { closeBotItem, openBotItem } from '@/components/bots/items/bot-item-open'
import { forgetBotItemWalk } from '@/components/bots/items/use-bot-item-walk'
import type { Bot } from '../../../../shared/bot-types'
import type { BotItemsListRead } from '../../../../shared/bots/bot-item-schema'
import { readForkBotRowClick } from '../../../../shared/fork/bot-row-ask-jump'
import { readForkBotAsks } from './bot-asks-store'
import { forkBotAsksOf, forkBotRowAskPick, type ForkBotAsk } from './bot-asks-view'

const ASK_CARD = '[data-bot-item-ask="open"]'
/** Frames to wait for the item's ask card to draw before giving up on scrolling to it. */
const REVEAL_FRAMES = 60

/** The ask this module last showed, per bot key. */
const lastShown = new Map<string, string>()

/** The ask last shown for `bot`, if its Home tab still shows an ask card. */
function shownAskUid(bot: Bot): string | null {
  const uid = lastShown.get(botRefKey(bot))
  if (!uid) {
    return null
  }
  const state = useAppStore.getState()
  if (!state.rightSidebarOpen || state.rightSidebarTab !== 'bot-activity') {
    return null
  }
  const active = findBotByWorkspace(readBots(), state.activeWorktreeId)
  if (!active || botRefKey(active) !== botRefKey(bot)) {
    return null
  }
  return typeof document !== 'undefined' && document.querySelector(ASK_CARD) ? uid : null
}

/** The bot's waiting asks, oldest first: the inbox's live copy when it holds them, else one read. */
async function asksOf(bot: Bot): Promise<ForkBotAsk[]> {
  const key = botRefKey(bot)
  const held = readForkBotAsks().filter((ask) => botRefKey(ask.bot) === key)
  if (held.length > 0) {
    return held
  }
  const read = await callBotRpc<BotItemsListRead>(bot, 'bots.items.owner.list', { botId: bot.id })
  return forkBotAsksOf([{ bot, items: Array.isArray(read?.items) ? read.items : [] }], Date.now())
}

/** Scrolls the newly drawn ask card into view; `before` is the card on screen before the jump. */
export function revealAskCard(before: Element | null): void {
  if (typeof requestAnimationFrame === 'undefined') {
    return
  }
  let frames = 0
  const look = (): void => {
    const card = document.querySelector(ASK_CARD)
    // Another item remounts its view, so a new card is a new node; the same item keeps its card.
    if (card && (card !== before || frames >= REVEAL_FRAMES / 2)) {
      card.scrollIntoView({ block: 'nearest' })
    } else if (++frames < REVEAL_FRAMES) {
      requestAnimationFrame(look)
    }
  }
  requestAnimationFrame(look)
}

async function jump(bot: Bot, shownUid: string | null): Promise<void> {
  const asks = await asksOf(bot)
  const next = forkBotRowAskPick(asks, shownUid)
  if (!next) {
    return
  }
  const before = typeof document === 'undefined' ? null : document.querySelector(ASK_CARD)
  lastShown.set(botRefKey(bot), next.item.uid)
  openBotItem(bot, next.item.uid)
  revealAskCard(before)
}

/** Shows the bot's Home list: an item left open is forgotten, and a mounted panel goes back to the list. */
function showHomeList(bot: Bot): void {
  lastShown.delete(botRefKey(bot))
  forgetBotItemWalk(botRefKey(bot))
  closeBotItem(bot)
}

/**
 * The bot row's click (upstream hook in `BotRow.tsx`): runs upstream's `open`, then, when it opened
 * the bot and the bot has asks waiting, shows its list, or the first ask (or the next, when one
 * already shows), by `forkBotRowAskJump`.
 */
export function forkOpenBotRow(bot: Bot, open: () => boolean): boolean {
  const click = readForkBotRowClick(useAppStore.getState().settings)
  const waiting = (readBotItemsNeedingOwner(bot) ?? 0) > 0
  const item = click === 'item' && waiting
  // Read before upstream's open switches the active workspace.
  const shownUid = item ? shownAskUid(bot) : null
  const opened = open()
  if (opened && click === 'list' && waiting) {
    showHomeList(bot)
  } else if (opened && item) {
    void jump(bot, shownUid).catch((error: unknown) => {
      console.warn('[fork bot row ask jump] reading the bot items failed', error)
    })
  }
  return opened
}
