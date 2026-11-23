// Test fixtures for Needs you: one of each kind of entry, built without a window.
import type { Bot } from '../../../../shared/bot-types'
import { makeTestBotItem } from '../../../../shared/bots/bot-item.test-fixture'
import type { BotItem } from '../../../../shared/bots/bot-items'
import type { ForkIdleRecoveryInboxItem } from '../../../../shared/fork/idle-recovery-wire'
import type { ForkBoardViewAsk } from '../../../../shared/fork/letters-wire'
import type { DashboardCard } from '../../../../shared/agent-status/presentation/dashboard-snapshot'
import type { ForkBotAsk } from '../bot-asks/bot-asks-view'

export const NOW = 1_000_000_000

export function bot(id: string, hostId = 'local'): Bot {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the rules read only id, name and hostId.
  return { id, name: `Bot ${id}`, hostId } as Bot
}

export function botAsk(
  b: Bot,
  number: number,
  since: number,
  fields: Partial<BotItem> = {}
): ForkBotAsk {
  const item = makeTestBotItem(number, {
    status: 'needs_you',
    owner: { botId: b.id, name: null },
    lastActivityAt: since,
    question: { eventId: `e${number}`, text: `Question ${number}?` },
    ...fields
  })
  return {
    key: `${b.hostId}/${b.id}/${item.uid}/${item.question?.eventId}`,
    bot: b,
    item,
    question: item.question,
    since
  }
}

export function chat(
  id: string,
  since: number,
  fields: Partial<ForkIdleRecoveryInboxItem> = {}
): ForkIdleRecoveryInboxItem {
  return {
    chatId: id,
    kind: 'chat',
    agent: 'claude',
    title: `Chat ${id}`,
    workspace: 'main',
    worktreeId: `wt-${id}`,
    verdict: 'waiting_user',
    question: `Shall I go on with ${id}?`,
    reason: 'asked a question',
    since,
    wakes: 0,
    wakeAt: null,
    paused: false,
    ...fields
  }
}

export function boardAsk(
  id: string,
  at: number,
  fields: Partial<ForkBoardViewAsk> = {}
): ForkBoardViewAsk {
  return {
    id,
    type: 'DECIDE',
    title: `Ask ${id}`,
    body: `Body of ${id}\nsecond line`,
    from: {
      chatId: 'chat-b',
      kind: 'chat',
      title: 'Board chat',
      agent: 'codex',
      worktreeId: 'wt-b',
      host: null
    },
    at,
    state: 'open',
    closedAt: null,
    closedBy: null,
    note: null,
    source: null,
    ...fields
  }
}

export function card(
  paneKey: string,
  changedAt: number,
  fields: Partial<DashboardCard> = {}
): DashboardCard {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the rules read only the fields set here.
  return {
    paneKey,
    agentType: 'claude',
    bucket: 'attention',
    worktreeId: `wt-${paneKey}`,
    tabId: `tab-${paneKey}`,
    worktreeName: `worktree ${paneKey}`,
    task: `Task ${paneKey}`,
    askSummary: 'Allow Bash(rm)?',
    stateChangedAt: changedAt,
    startedAt: changedAt - 10,
    ...fields
  } as DashboardCard
}
