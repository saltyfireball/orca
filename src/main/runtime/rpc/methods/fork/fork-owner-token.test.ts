import '../../dispatch/testing/unused-default-rpc-methods.test-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../../dispatcher'
import { DESKTOP_RPC_CALLER } from '../../callers/rpc-caller-identity'
import type { RpcRequest } from '../../core'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import { makeTestBot } from '../../../../bots/bot.test-fixture'
import { BotItemsHost, type BotItemsHostDeps } from '../../../../bots/bot-items-runtime'
import type { BotItemMail } from '../../../../bots/bot-items-schema'
import { BotsDbWorkerClient } from '../../../../bots/db-worker/bots-db-worker-client'
import { closeBotsDbStores } from '../../../../bots/db-worker/bots-db-worker-entry'
import { inProcessBotsDbWorker } from '../../../../bots/db-worker/bots-db-worker.test-fixture'
import { OwnerTokenStore } from '../../../../fork/owner-token/owner-token-store'
import { BOT_ITEMS_METHODS } from '../bots-items'
import { forkOwnerTokenMethods } from './fork-owner-token'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../../../orca-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => paths.userData
}))
vi.mock(import('../bots-chats'), async (importOriginal) => ({
  ...(await importOriginal()),
  botChatTakingMail: vi.fn(async () => null)
}))

const CHAT = 'chat-home'
const mailed: { chatId: string; kind: string }[] = []
let host: BotItemsHost | null = null

// No callerSessionId and no evidence: a plain shell's CLI, which the host takes as an agent's.
const shell = (method: string, params: Record<string, unknown> = {}): RpcRequest => ({
  id: 'req-1',
  authToken: 'tok',
  method,
  params
})

function setup() {
  const bots = [
    makeTestBot({ id: 'ranger', name: 'Ranger' }),
    makeTestBot({ id: 'docs', name: 'Docs' })
  ]
  const db = {
    db: { prepare: () => ({ get: () => undefined }) },
    getMessageById: () => undefined,
    getDispatchContextById: () => undefined
  }
  const deps = {
    workRuntime: { getOrchestrationDb: () => db },
    db: new BotsDbWorkerClient(inProcessBotsDbWorker().factory),
    bots: () => bots,
    githubCache: () => ({ pr: {}, issue: {} }),
    chatTitle: () => null,
    chatExists: () => true,
    chatRoot: (id: string) => id,
    threadChats: () => [],
    automationRunChats: () => [],
    notify: () => {},
    sendMail: async (mail: BotItemMail) => {
      mailed.push(...mail.changes.map(({ event }) => ({ chatId: mail.chatId, kind: event.kind })))
      return true
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the host reads only these fields of the work runtime and database.
  host = new BotItemsHost(deps as unknown as BotItemsHostDeps)
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    bots: { assertEnabled: () => {}, enabled: () => true, list: () => bots },
    botItems: host,
    getOrchestrationDb: () => db,
    ensureStructuredAgentSessionHost: async () => {}
  }
  const tokens = new OwnerTokenStore(paths.userData)
  const dispatcher = new RpcDispatcher({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these methods read only bots, botItems and the orchestration database, which the stub provides.
    runtime: runtime as unknown as OrcaRuntimeService,
    methods: [...BOT_ITEMS_METHODS, ...forkOwnerTokenMethods(() => tokens)]
  })
  return { dispatcher, host }
}

/** Ranger's item 1, waiting on the owner's answer. */
async function askingItem(items: BotItemsHost): Promise<string> {
  const actor = { kind: 'bot' as const, botId: 'ranger', chatId: CHAT }
  const { uid } = await items.store().add(
    {
      ownerBotId: 'ranger',
      chatId: CHAT,
      source: { kind: 'home', title: 'Home Chat' },
      title: 'Ship the release',
      status: 'working',
      links: []
    },
    actor
  )
  await items.store().set(uid, { status: 'needs_you', comment: 'Merge without the review?' }, actor)
  return uid
}

beforeEach(() => {
  paths.userData = mkdtempSync(join(tmpdir(), 'owner-token-rpc-'))
  mailed.length = 0
})

afterEach(() => {
  host?.dispose()
  host = null
  closeBotsDbStores()
  rmSync(paths.userData, { recursive: true, force: true })
})

describe('owner token over RPC', () => {
  it("reads a bot's items from a plain shell with no bot chat or terminal", async () => {
    const { dispatcher, host: items } = setup()
    await askingItem(items)
    expect(
      await dispatcher.dispatch(shell('bots.items.list', { botId: 'ranger', all: true }))
    ).toMatchObject({ ok: true, result: { botName: 'Ranger', items: [{ number: 1 }] } })
    expect(await dispatcher.dispatch(shell('bots.items.show', { item: '1' }))).toMatchObject({
      ok: true,
      result: { item: { number: 1, status: 'needs_you' } }
    })
  })

  it("is minted only from the owner's Orca, never by an agent's CLI", async () => {
    const { dispatcher } = setup()
    expect(await dispatcher.dispatch(shell('fork.ownerToken.mint'))).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' }
    })
    expect(
      await dispatcher.dispatch(shell('fork.ownerToken.status'), { caller: DESKTOP_RPC_CALLER })
    ).toMatchObject({ ok: true, result: { exists: false, createdAt: null } })
    const minted = await dispatcher.dispatch(shell('fork.ownerToken.mint'), {
      caller: DESKTOP_RPC_CALLER
    })
    expect(minted).toMatchObject({
      ok: true,
      result: { token: expect.stringMatching(/^orcaown_/) }
    })
  })

  it('answers a Needs you item from a plain shell as the owner does, and only with the right token', async () => {
    const { dispatcher, host: items } = setup()
    const uid = await askingItem(items)
    const minted = await dispatcher.dispatch(shell('fork.ownerToken.mint'), {
      caller: DESKTOP_RPC_CALLER
    })
    const token = minted.ok ? (minted.result as { token: string }).token : ''

    const wrong = await dispatcher.dispatch(
      shell('fork.botItems.ownerAnswer', { ownerToken: `${token}x`, item: '1', text: 'Merge now' })
    )
    expect(wrong).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(JSON.stringify(wrong)).not.toContain(token)
    const otherBot = await dispatcher.dispatch(
      shell('fork.botItems.ownerAnswer', {
        ownerToken: token,
        item: '1',
        text: 'Hi',
        botId: 'docs'
      })
    )
    expect(otherBot).toMatchObject({ ok: false })
    expect((await items.store().get(uid))?.status).toBe('needs_you')

    const answered = await dispatcher.dispatch(
      shell('fork.botItems.ownerAnswer', {
        ownerToken: token,
        item: '1',
        text: 'Merge now',
        botId: 'ranger'
      })
    )
    expect(answered).toMatchObject({
      ok: true,
      result: { item: { number: 1, status: 'working', owner: 'Ranger' } }
    })
    const comment = (await items.events(uid, 0, 50)).find(
      (event) => event.kind === 'commented' && event.actor.kind === 'owner'
    )
    expect(comment).toMatchObject({
      actor: { kind: 'owner', device: 'owner-token' },
      data: { text: 'Merge now\n\n_Answered via owner token._', answers: expect.any(String) }
    })
    await items.sendOwedMail()
    expect(mailed).toContainEqual({ chatId: CHAT, kind: 'commented' })

    await dispatcher.dispatch(shell('fork.ownerToken.revoke'), { caller: DESKTOP_RPC_CALLER })
    expect(
      await dispatcher.dispatch(
        shell('fork.botItems.ownerAnswer', { ownerToken: token, item: '1', text: 'Again' })
      )
    ).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
  })
})
