// Needs you (FORK.md "Needs you list", BAD-759): the pure rules. Everything that waits on the owner
// is merged into one list of entries from the Decision inbox's own data (the bots' asks, chats
// waiting on the owner or paused by a guard, the board's asks) and the agents upstream's dashboard
// counts under Needs you (an approval or a question), grouped by bot or agent, the most recent ask
// first. Stalled and paused chats are not here: they stay in the Decision inbox.
import type { Bot } from '../../../../shared/bot-types'
import type { ExecutionHostId } from '../../../../shared/execution-host/execution-host'
import { formatBotItemNumber } from '../../../../shared/bots/bot-items'
import type { ForkIdleRecoveryInboxItem } from '../../../../shared/fork/idle-recovery-wire'
import type { ForkBoardViewAsk } from '../../../../shared/fork/letters-wire'
import type { DashboardCard } from '../../../../shared/agent-status/presentation/dashboard-snapshot'
import { botItemQuestionLine } from '../../../../shared/bots/bot-item-ask'
import { botRefKey } from '@/lib/bot-hosts'
import { forkBotAskLine, type ForkBotAsk } from '../bot-asks/bot-asks-view'

export type NeedsYouTarget =
  | { kind: 'bot-ask'; ask: ForkBotAsk }
  | { kind: 'chat'; item: ForkIdleRecoveryInboxItem }
  | { kind: 'board'; ask: ForkBoardViewAsk }
  | { kind: 'agent'; card: DashboardCard }

export type NeedsYouEntry = {
  /** Stable across reads while the same thing waits. */
  key: string
  groupKey: string
  /** The bot or agent's name. */
  name: string
  /** The bot whose picture is shown; null for an agent or chat, which show their agent's icon. */
  bot: Bot | null
  /** The agent kind behind a chat, board ask or agent entry, for its icon. */
  agent: string | null
  /** '#10' for a bot's item; null elsewhere. */
  number: string | null
  /** The bot's item title, the chat's title, or the board ask's title. */
  title: string
  /** The question in one line. */
  line: string
  /** Epoch ms on this window's clock. */
  since: number
  /** The paired server it lives on; null for this computer. */
  hostId: string | null
  /** The paired server's display name when known. */
  hostLabel: string | null
  target: NeedsYouTarget
}

export type NeedsYouGroup = {
  key: string
  name: string
  bot: Bot | null
  agent: string | null
  entries: NeedsYouEntry[]
  /** The newest ask's time: groups sort on it, newest first. */
  latest: number
}

export type NeedsYouSources = {
  botAsks: readonly ForkBotAsk[]
  /** The Decision inbox's chats, as read, and the offset that moves their host clock to this window's. */
  chats: readonly ForkIdleRecoveryInboxItem[]
  chatClockOffset: number
  board: readonly ForkBoardViewAsk[]
  boardClockOffset: number
  /** The dashboard's cards in the Needs you bucket. */
  agents: readonly DashboardCard[]
  /** A paired server's display name by its id; none for this computer. */
  hostLabelOf?: (hostId: ExecutionHostId) => string | null
}

const LOCAL_HOST = 'local'

function oneLine(text: string, fallback: string): string {
  return botItemQuestionLine(text) || fallback
}

function botEntry(ask: ForkBotAsk, labelOf: NeedsYouSources['hostLabelOf']): NeedsYouEntry {
  const remote = ask.bot.hostId !== LOCAL_HOST
  return {
    key: `bot:${ask.key}`,
    groupKey: `bot:${botRefKey(ask.bot)}`,
    name: ask.item.owner.name ?? ask.bot.name,
    bot: ask.bot,
    agent: null,
    number: formatBotItemNumber(ask.item.number),
    title: ask.item.title,
    line: forkBotAskLine(ask),
    since: ask.since,
    hostId: remote ? ask.bot.hostId : null,
    hostLabel: remote ? (labelOf?.(ask.bot.hostId) ?? null) : null,
    target: { kind: 'bot-ask', ask }
  }
}

function chatEntry(item: ForkIdleRecoveryInboxItem, offset: number): NeedsYouEntry {
  return {
    key: `chat:${item.source ?? 'idle'}:${item.chatId}`,
    groupKey: `chat:${item.chatId}`,
    name: item.title || item.agent,
    bot: null,
    agent: item.agent || null,
    number: null,
    title: item.workspace,
    line: oneLine(item.question, item.reason),
    since: item.since + offset,
    hostId: null,
    hostLabel: null,
    target: { kind: 'chat', item }
  }
}

function boardEntry(ask: ForkBoardViewAsk, offset: number): NeedsYouEntry {
  const shell = ask.from.kind === 'shell'
  return {
    key: `board:${ask.source?.environmentId ?? ''}:${ask.id}`,
    // An agent's board ask groups with that agent's other asks.
    groupKey: shell ? `board:${ask.source?.environmentId ?? ''}:shell` : `chat:${ask.from.chatId}`,
    name: shell ? ask.title : ask.from.title || ask.from.chatId.slice(0, 12),
    bot: null,
    agent: shell ? null : ask.from.agent || null,
    number: null,
    title: ask.title,
    line: oneLine(ask.body, ask.title),
    since: ask.at + offset,
    hostId: ask.source?.environmentId ?? null,
    hostLabel: ask.source?.name ?? null,
    target: { kind: 'board', ask }
  }
}

function agentEntry(card: DashboardCard, labelOf: NeedsYouSources['hostLabelOf']): NeedsYouEntry {
  const hostId = card.executionHostId
  const remote = hostId !== undefined && card.hostKind === 'remote'
  const name = card.conversationName || card.task || card.worktreeName
  return {
    key: `agent:${card.paneKey}`,
    groupKey: `chat:${card.paneKey}`,
    name,
    bot: null,
    agent: card.agentType,
    number: null,
    title: card.worktreeName,
    line: card.askSummary ? oneLine(card.askSummary, name) : name,
    since: card.stateChangedAt || card.startedAt,
    hostId: remote ? hostId : null,
    hostLabel: remote ? (card.hostLabel ?? labelOf?.(hostId) ?? null) : null,
    target: { kind: 'agent', card }
  }
}

/** The merged entries, newest ask first; chats and agents already listed as a chat are not repeated. */
export function needsYouEntries(sources: NeedsYouSources): NeedsYouEntry[] {
  const entries: NeedsYouEntry[] = []
  for (const ask of sources.botAsks) {
    entries.push(botEntry(ask, sources.hostLabelOf))
  }
  const chatIds = new Set<string>()
  for (const item of sources.chats) {
    // Waiting chats and chats an agent guard paused wait on the owner; stalled and paused ones do not.
    if (item.paused || (item.verdict !== 'waiting_user' && item.verdict !== 'guard')) {
      continue
    }
    chatIds.add(item.chatId)
    entries.push(chatEntry(item, sources.chatClockOffset))
  }
  for (const ask of sources.board) {
    entries.push(boardEntry(ask, sources.boardClockOffset))
  }
  for (const card of sources.agents) {
    // A subagent has no pane of its own, and a chat the inbox lists is not listed twice.
    if (card.parentPaneKey || chatIds.has(card.paneKey)) {
      continue
    }
    entries.push(agentEntry(card, sources.hostLabelOf))
  }
  return entries.sort((a, b) => b.since - a.since || a.key.localeCompare(b.key))
}

/** Entries grouped by bot or agent. Groups and the entries inside each go newest first. */
export function needsYouGroups(entries: readonly NeedsYouEntry[]): NeedsYouGroup[] {
  const groups = new Map<string, NeedsYouGroup>()
  for (const entry of entries) {
    const group = groups.get(entry.groupKey)
    if (group) {
      group.entries.push(entry)
      group.latest = Math.max(group.latest, entry.since)
    } else {
      groups.set(entry.groupKey, {
        key: entry.groupKey,
        name: entry.name,
        bot: entry.bot,
        agent: entry.agent,
        entries: [entry],
        latest: entry.since
      })
    }
  }
  const list = [...groups.values()]
  for (const group of list) {
    group.entries.sort((a, b) => b.since - a.since || a.key.localeCompare(b.key))
  }
  return list.sort((a, b) => b.latest - a.latest || a.key.localeCompare(b.key))
}

/** The entries in the order the list shows them: group by group. */
export function needsYouFlat(groups: readonly NeedsYouGroup[]): NeedsYouEntry[] {
  return groups.flatMap((group) => group.entries)
}

/** Groups with the entries the filter keeps: every word must be in the name, number, title, question or host. */
export function filterNeedsYouGroups(
  groups: readonly NeedsYouGroup[],
  filter: string
): NeedsYouGroup[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return [...groups]
  }
  const kept: NeedsYouGroup[] = []
  for (const group of groups) {
    const entries = group.entries.filter((entry) => {
      const hay = [entry.name, entry.number, entry.title, entry.line, entry.hostLabel]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return words.every((word) => hay.includes(word))
    })
    if (entries.length > 0) {
      kept.push({ ...group, entries })
    }
  }
  return kept
}

/** The selection after an arrow key: wraps, and stays null with nothing listed. */
export function needsYouMove(count: number, from: number, direction: 1 | -1): number | null {
  if (count === 0) {
    return null
  }
  const start = from < 0 || from >= count ? (direction === 1 ? -1 : 0) : from
  return (start + direction + count) % count
}

/**
 * The entry "next" goes to after the one last jumped to: the one after it when it still waits
 * (wrapping), else the one now at its place, so answering one moves on to the following.
 * Null with nothing waiting, or when the only thing waiting is the one just shown.
 */
export function needsYouNextEntry(
  entries: readonly NeedsYouEntry[],
  last: { key: string; index: number } | null
): NeedsYouEntry | null {
  if (entries.length === 0) {
    return null
  }
  if (!last) {
    return entries[0] ?? null
  }
  const at = entries.findIndex((entry) => entry.key === last.key)
  if (at === -1) {
    return entries[Math.min(last.index, entries.length - 1)] ?? null
  }
  if (entries.length === 1) {
    return null
  }
  return entries[(at + 1) % entries.length] ?? null
}
