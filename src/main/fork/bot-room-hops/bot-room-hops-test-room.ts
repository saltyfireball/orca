// Bot room hop limit (BAD-801): a group room of three bots over the real room store (SQLite), the
// real BotGroupRuntime, hand-off and Decision inbox registry. Faked: the bot list and settings the
// runtime reads, and the member chats (a reply is written on its turn, or ended through a journal).
import { expect, vi } from 'vitest'
import type { BotGroup, BotGroupMessage, BotGroupTurn } from '../../../shared/bots/bot-group'
import SyncDatabase from '../../sqlite/sync-database'
import { handOffGroupMentions } from '../../bots/bot-group-mention-handoffs'
import { BotGroupRuntime } from '../../bots/bot-group-runtime'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { inboxSourceItems } from '../idle-recovery/idle-recovery-sources'

export const BOTS = [
  { id: 'bot-a', name: 'Ada' },
  { id: 'bot-b', name: 'Bo' },
  { id: 'bot-c', name: 'Cy' }
].map((bot) => ({ ...bot, avatar: null, agent: 'claude', paused: false }))

const nameOf = (botId: string) => BOTS.find((bot) => bot.id === botId)!.name

export const memberSession = (botId: string) => `bot-group-member-${botId}`

const GROUP: BotGroup = {
  id: 'room-1',
  name: 'Harbor',
  hostId: 'local',
  revision: 1,
  folder: '/work/harbor',
  folderWorkspaceId: 'folder:harbor',
  createdAt: 0,
  members: BOTS.map((bot) => ({ botId: bot.id, sessionId: memberSession(bot.id) })),
  replyMode: { kind: 'all' }
}

/** A room on `db` (a new in-memory one by default); an existing room in `db` is kept as stored. */
export function room(settings: Record<string, unknown>, db = new SyncDatabase(':memory:')) {
  const runtime = {
    getOrchestrationDb: () => ({ db }),
    bots: { list: () => BOTS },
    requireStore: () => ({ getSettings: () => settings }),
    notifyBotGroupsChanged: () => {},
    ensureStructuredAgentSessionHost: async () => undefined
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the room reads only these runtime members.
  const service = runtime as unknown as OrcaRuntimeService
  const groups = new BotGroupRuntime(service)
  const group = GROUP
  if (!groups.store.list().some((stored) => stored.id === group.id)) {
    groups.store.put(group)
  }
  const turnFor = (botId: string): BotGroupTurn => ({
    operationId: `op-${crypto.randomUUID()}`,
    botId,
    botName: nameOf(botId),
    avatar: null,
    agent: 'claude',
    sessionId: memberSession(botId)
  })
  /** A person's post that `botIds` answer. */
  const post = (id: string, botIds: string[]): BotGroupMessage =>
    groups.store.append({
      id,
      groupId: group.id,
      author: { kind: 'owner' },
      text: 'Plan the launch',
      createdAt: Date.now(),
      turns: botIds.map(turnFor)
    })
  /** The woken turns' sends settle (each fails, or the journal says it was sent). */
  const settled = async () => {
    await vi.waitFor(() => expect(groups.store.pending()).toEqual([]))
    await vi.waitFor(() => expect(groups.deliveries.size).toBe(0))
  }
  const wokenBy = (operationId: string): BotGroupMessage[] =>
    BOTS.flatMap((bot) => groups.store.message(`handoff:${operationId}:${bot.id}`) ?? [])
  /** `botId`'s turn on `lineId` ends with `text`, written on its turn by hand; the lines it woke. */
  const reply = async (lineId: string, botId: string, text: string): Promise<BotGroupMessage[]> => {
    const line = groups.store.message(lineId)!
    const turn = line.turns.find((candidate) => candidate.botId === botId)!
    groups.store.update({
      ...line,
      turns: line.turns.map((candidate) =>
        candidate.operationId === turn.operationId ? { ...candidate, reply: text } : candidate
      )
    })
    await handOffGroupMentions(groups, groups.store.message(lineId)!, turn, {
      full: text,
      saved: text
    })
    await settled()
    return wokenBy(turn.operationId)
  }
  const turnOn = (lineId: string) => groups.store.message(lineId)!.turns[0]!
  const hopItems = async () => (await inboxSourceItems()).filter((item) => item.source === 'hops')
  return { db, runtime: service, groups, group, post, reply, settled, wokenBy, turnOn, hopItems }
}

export type Room = ReturnType<typeof room>

type Speak = (r: Room, lineId: string, botId: string, text: string) => Promise<BotGroupMessage[]>

/** The woken member of `lineId` names the other of Ada and Bo, round after round, until a reply
 *  wakes nobody; the hand-off lines in order. `speak` ends each turn (by hand unless given). */
export async function pingPong(
  r: Room,
  lineId: string,
  rounds: number,
  speak: Speak = (room, line, botId, text) => room.reply(line, botId, text)
): Promise<string[]> {
  const lines: string[] = []
  let at = lineId
  for (let round = 0; round < rounds; round += 1) {
    const speaker = r.turnOn(at).botId
    const other = speaker === 'bot-a' ? 'Bo' : 'Ada'
    const woken = await speak(r, at, speaker, `Round ${round}. @${other} your turn.`)
    if (woken.length === 0) {
      break
    }
    at = woken[0]!.id
    lines.push(at)
  }
  return lines
}
