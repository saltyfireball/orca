// Pause all over inbound connector turns (BAD-818): the real bot conversation choice
// (`botChatFor` over `botConversations`) with the real switch in a temporary data folder. A message
// to a bot is refused as bot_paused while paused or with an unreadable switch, before any chat is
// opened or started; when not paused it reaches the bot's chat. Faked: the bot list, the chats a
// bot opens, and an empty link store.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => paths.userData }),
  hasAppEnvironment: () => true
}))

import type { Bot } from '../../../shared/bot-types'
import { botConversations } from '../../bots/bot-conversations'
import { botChatFor } from '../../external-conversations/external-conversation-bots'
import type { ExternalConversationLinkStore } from '../../external-conversations/external-conversation-link-index'
import {
  PAUSE_ALL_STATE_FILE_NAME,
  resetForkPauseAllCacheForTests,
  writeForkPauseAll
} from './pause-all-state'

beforeEach(() => {
  paths.userData = mkdtempSync(join(tmpdir(), 'pause-all-connector-'))
  resetForkPauseAllCacheForTests()
})
afterEach(() => {
  rmSync(paths.userData, { recursive: true, force: true })
})

const BOT = {
  id: 'bot-1',
  name: 'Fern',
  agent: 'claude',
  paused: false,
  folderWorkspaceId: 'home-1'
}
const KEY = { source: 'slack', externalId: 'T1:C1:1700000000.000100' } as const

function rig() {
  const ensureChat = vi.fn(async () => 'chat-1')
  const startSession = vi.fn(async () => 'thread-chat-1')
  const bots = botConversations({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the choice reads only id, paused and the home.
    bots: { enabled: () => true, list: () => [BOT as unknown as Bot] },
    ensureChat,
    startSession,
    botWork: { pullRequests: async () => [] }
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: an empty store has no links to find.
  const store = {
    getAllWorktreeMeta: () => ({}),
    getFolderWorkspaces: () => [],
    getRepos: () => []
  } as unknown as ExternalConversationLinkStore
  const choose = (kind: 'bot' | 'bot-chat') =>
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the choice reads only kind and botId of the target.
    botChatFor(store, bots, KEY, { kind, botId: BOT.id } as never)
  return { choose, ensureChat, startSession }
}

describe('pause all over inbound connector turns', () => {
  it('refuses a mention or a DM to a bot as bot_paused while paused, opening no chat', async () => {
    const r = rig()
    writeForkPauseAll(true, { by: 'cli' })
    expect(await r.choose('bot')).toEqual({ outcome: 'refused', reason: 'bot_paused' })
    expect(await r.choose('bot-chat')).toEqual({ outcome: 'refused', reason: 'bot_paused' })
    expect(r.startSession).not.toHaveBeenCalled()
    expect(r.ensureChat).not.toHaveBeenCalled()
  })

  it('refuses with an unreadable switch', async () => {
    const r = rig()
    writeFileSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME), '[]')
    expect(await r.choose('bot')).toEqual({ outcome: 'refused', reason: 'bot_paused' })
    expect(r.startSession).not.toHaveBeenCalled()
  })

  it('reaches the bot when not paused', async () => {
    const r = rig()
    expect(await r.choose('bot')).toMatchObject({ sessionId: 'thread-chat-1' })
    expect(await r.choose('bot-chat')).toMatchObject({ sessionId: 'chat-1' })
  })
})
