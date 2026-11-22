// Auto-close finished bot chats (FORK.md, BAD-734): the pass wired to this process's runtime. One
// hook inside installForkWorkerArchive starts the timer; the desktop, `orca serve` and orcad each
// run it for their own bots. The first pass is the one-time sweep: it judges every existing chat
// with the same rule. `fork.botChat.cleanup` runs the same pass by hand, as a dry run or for real.
import {
  forkBotChatAutoCloseEnabled,
  forkCardStateOf,
  forkOwnerTypedAt,
  type ForkBotChatCardState
} from '../../../shared/fork/bot-chat-auto-close'
import { ORCA_SESSION_ADDRESS_PREFIX } from '../../../shared/agent-session/identity/orca-session-address-prefix'
import { readSharedBotChatTree } from '../../bots/bot-chat-tree-host'
import { writeInChat } from '../../bots/bot-chat-status-line'
import { readAgentSessionRecordStore } from '../../runtime/orchestration/addressing/session-lineage/structured-session-lineage'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { closeStructuredAgentSessionChild } from '../../runtime/agent-session/lifecycle/structured-agent-session-close'
import { startForkBackoffTimer } from '../fork-backoff-timer'
import { closeForkBotChat } from './bot-chat-close'
import { rememberAutoClosedChat } from './bot-chat-auto-closed-registry'
import {
  runBotChatAutoClosePass,
  type AutoCloseChatReads,
  type BotChatAutoCloseDeps,
  type BotChatAutoCloseRow
} from './bot-chat-auto-close'

export const FORK_BOT_CHAT_AUTO_CLOSE_SWEEP_MS = 2 * 60_000
export const FORK_BOT_CHAT_AUTO_CLOSE_IDLE_SWEEP_MS = 10 * 60_000
/** A card that is not Done yet is asked about again after this long; a finished one never. */
const OPEN_CARD_RECHECK_MS = 10 * 60_000

type Runtime = OrcaRuntimeService

type MessageTimes = {
  inbound: string | null
  unread: string | null
  reported: string | null
  handoff: number
}

/** SQLite `datetime('now')` is UTC without a zone; ISO strings carry theirs. */
export function messageTimeMs(text: string | null | undefined): number | null {
  if (!text) {
    return null
  }
  const parsed = Date.parse(
    /[zZ]|[+-]\d\d:?\d\d$/.test(text) || text.includes('T') ? text : `${text.replace(' ', 'T')}Z`
  )
  return Number.isFinite(parsed) ? parsed : null
}

function newest(a: string | null, b: string | null): string | null {
  return a === null
    ? b
    : b === null
      ? a
      : (messageTimeMs(a) ?? 0) >= (messageTimeMs(b) ?? 0)
        ? a
        : b
}

function readMessageTimes(db: OrchestrationDb, chatId: string): MessageTimes {
  const address = `${ORCA_SESSION_ADDRESS_PREFIX}${chatId}`
  const one = (sql: string): Record<string, unknown> | undefined =>
    db.db.prepare(sql).get(address) as Record<string, unknown> | undefined
  const text = (row: Record<string, unknown> | undefined): string | null =>
    typeof row?.at === 'string' ? row.at : null
  const inbound = text(
    one(`SELECT MAX(created_at) AS at FROM messages WHERE to_handle = ? AND type != 'heartbeat'`)
  )
  const unread = text(
    one(
      `SELECT MAX(created_at) AS at FROM messages WHERE to_handle = ? AND read = 0 AND type != 'heartbeat'`
    )
  )
  const sent = text(
    one(`SELECT MAX(created_at) AS at FROM messages WHERE from_handle = ? AND type = 'worker_done'`)
  )
  const answered = text(
    one(
      `SELECT MAX(o.recorded_at) AS at FROM bot_requests r
         JOIN messages m ON m.id = r.message_id
         JOIN bot_request_outcomes o ON o.message_id = r.message_id
        WHERE m.to_handle = ? AND r.purpose = 'handoff' AND o.outcome IN ('answered', 'posted')`
    )
  )
  const handoff = Number(
    one(
      `SELECT COUNT(*) AS at FROM bot_requests r JOIN messages m ON m.id = r.message_id
        WHERE m.to_handle = ? AND r.purpose = 'handoff'`
    )?.at ?? 0
  )
  return { inbound, unread, reported: newest(sent, answered), handoff }
}

async function openItemChats(runtime: Runtime, botId: string): Promise<Set<string>> {
  try {
    const { items } = await runtime.botItems
      .store()
      .list({ botId, statuses: ['needs_you'], limit: 500 })
    return new Set(items.map((item) => item.chatId))
  } catch {
    // Unreadable items must not let a chat with an open ask close.
    return new Set(['*'])
  }
}

const cardCache = new Map<string, { state: ForkBotChatCardState; url?: string; at: number }>()

async function readCardState(
  runtime: Runtime,
  key: string,
  now: number
): Promise<{ state: ForkBotChatCardState; url?: string }> {
  const known = cardCache.get(key)
  if (
    known &&
    (known.state === 'done' || known.state === 'canceled' || now - known.at < OPEN_CARD_RECHECK_MS)
  ) {
    return known
  }
  let read: { state: ForkBotChatCardState; url?: string } = { state: 'unknown' }
  try {
    const issue = await runtime.linearGetIssue(key)
    if (issue && issue.identifier.toLowerCase() === key.toLowerCase()) {
      read = { state: forkCardStateOf(issue.state.type), url: issue.url }
    }
  } catch {
    // Linear not connected or unreachable: the card rule does not apply this pass.
  }
  cardCache.set(key, { ...read, at: now })
  return read
}

export function runtimeBotChatAutoCloseDeps(
  runtime: Runtime,
  settings: unknown
): BotChatAutoCloseDeps {
  const itemChats = new Map<string, Promise<Set<string>>>()
  return {
    now: () => Date.now(),
    settings,
    bots: () =>
      runtime.bots.list().map((bot) => ({
        id: bot.id,
        name: bot.name,
        homeChatId: bot.chatSessionId ?? null
      })),
    readChats: async (botId) => (await readSharedBotChatTree(runtime, { botId })).chats,
    readFacts: async (bot, chat): Promise<AutoCloseChatReads> => {
      const records = readAgentSessionRecordStore()
      const record = records?.getRecord(chat.chatId) ?? null
      const times = readMessageTimes(runtime.getOrchestrationDb(), chat.chatId)
      let items = itemChats.get(bot.id)
      if (!items) {
        items = openItemChats(runtime, bot.id)
        itemChats.set(bot.id, items)
      }
      const open = await items
      const unreadAt = messageTimeMs(times.unread)
      return {
        autoStarted: chat.origin !== 'side' || times.handoff > 0,
        queued: unreadAt !== null && unreadAt > chat.lastActiveAt,
        openItem: open.has(chat.chatId) || open.has('*'),
        ownerTypedAt: forkOwnerTypedAt(record?.lastTurn, record?.createdAt),
        lastInboundAt: messageTimeMs(times.inbound),
        reportedBackAt: messageTimeMs(times.reported),
        ...(record?.lastTurn?.reply ? { reply: record.lastTurn.reply } : {})
      }
    },
    cardState: (key) => readCardState(runtime, key, Date.now()),
    close: async (bot, chat) => {
      const outcome = await closeForkBotChat(
        {
          readChats: async (botId) => (await readSharedBotChatTree(runtime, { botId })).chats,
          closeSession: (sessionId) => closeStructuredAgentSessionChild(sessionId, { runtime })
        },
        { botId: bot.id, chatId: chat.chatId }
      )
      if (outcome.closed) {
        await rememberAutoClosedChat(chat.chatId, bot.id)
      }
      return { closed: outcome.closed, ...(outcome.closed ? {} : { detail: outcome.reason }) }
    },
    noteInHome: (bot, text) => {
      if (bot.homeChatId) {
        writeInChat(bot.homeChatId, { kind: 'status', text }, 'chat-closed')
      }
    }
  }
}

function isAutoCloseRuntime(runtime: unknown): runtime is Runtime {
  return (
    typeof runtime === 'object' &&
    runtime !== null &&
    'bots' in runtime &&
    'botItems' in runtime &&
    'linearGetIssue' in runtime
  )
}

function settingsOf(runtime: Runtime): unknown {
  try {
    return runtime.requireStore?.().getSettings()
  } catch {
    return undefined
  }
}

/** The manual pass (`orca bot chats-cleanup`): this host's bots only; the RPC adds paired servers. */
export async function runForkBotChatCleanupLocal(
  runtime: unknown,
  params: { bot?: string; dryRun: boolean }
): Promise<{ enabled: boolean; rows: BotChatAutoCloseRow[] }> {
  if (!isAutoCloseRuntime(runtime)) {
    return { enabled: false, rows: [] }
  }
  const settings = settingsOf(runtime)
  const rows = await runBotChatAutoClosePass(runtimeBotChatAutoCloseDeps(runtime, settings), {
    ...(params.bot !== undefined ? { bot: params.bot } : {}),
    dryRun: params.dryRun
  })
  return { enabled: forkBotChatAutoCloseEnabled(settings), rows }
}

type Installed = { runtime: Runtime; running: boolean }
let installed: Installed | null = null
let stopTimer: (() => void) | null = null

/** Hook (from installForkWorkerArchive): starts the auto-close timer for this runtime. */
export function installForkBotChatAutoClose(runtime: unknown): void {
  if (!isAutoCloseRuntime(runtime) || installed?.runtime === runtime) {
    return
  }
  installed = { runtime, running: false }
  stopTimer ??= startForkBackoffTimer({
    run: sweepForkBotChatAutoClose,
    baseMs: FORK_BOT_CHAT_AUTO_CLOSE_SWEEP_MS,
    maxMs: FORK_BOT_CHAT_AUTO_CLOSE_IDLE_SWEEP_MS
  })
}

/** One timer tick; resolves false while the setting is off or nothing closed, so the timer backs off. */
export async function sweepForkBotChatAutoClose(): Promise<boolean> {
  const state = installed
  if (!state || state.running) {
    return true
  }
  const settings = settingsOf(state.runtime)
  if (!forkBotChatAutoCloseEnabled(settings) || !state.runtime.bots.enabled()) {
    return false
  }
  state.running = true
  try {
    const rows = await runBotChatAutoClosePass(
      runtimeBotChatAutoCloseDeps(state.runtime, settings),
      { dryRun: false }
    )
    const failed = rows.filter((row) => row.outcome === 'failed')
    if (failed.length > 0) {
      console.warn(
        '[fork bot chat auto-close] could not close',
        failed.map((row) => `${row.botName}:${row.chatId}:${row.error ?? ''}`).join(', ')
      )
    }
    return rows.some((row) => row.outcome === 'closed')
  } catch (error) {
    console.warn('[fork bot chat auto-close] pass failed', error)
    return false
  } finally {
    state.running = false
  }
}
