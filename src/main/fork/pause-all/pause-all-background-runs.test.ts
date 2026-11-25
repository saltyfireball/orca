// Pause all over bots' scheduled Look around and Tidy-up (BAD-818): the real runners and look-around
// store, with the real switch in a temporary data folder. A slot due while paused (or with an
// unreadable switch) starts no chat and says why in the history, survives a reload, never counts
// toward turning the feature off, and is not caught up at resume; the next slot runs. Faked: the
// host around the runners (bots, power, the session that would start).
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
import { BotLookAroundRunner } from '../../bots/bot-look-around-runner'
import { BotLookAroundStore } from '../../bots/bot-look-around-store'
import { failedLooksInARow } from '../../bots/bot-look-around-failures'
import { upNextState } from '../../bots/bot-look-around-state'
import { BotTidyUpRunner } from '../../bots/bot-memory-tidy-up-runner'
import { tidyUpState } from '../../bots/bot-memory-tidy-up'
import {
  PAUSE_ALL_STATE_FILE_NAME,
  resetForkPauseAllCacheForTests,
  writeForkPauseAll
} from './pause-all-state'

beforeEach(() => {
  paths.userData = mkdtempSync(join(tmpdir(), 'pause-all-runs-'))
  resetForkPauseAllCacheForTests()
})
afterEach(() => {
  rmSync(paths.userData, { recursive: true, force: true })
})

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute).getTime()

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runners read only these bot fields.
const BOT = {
  id: 'bot-1',
  name: 'Fern',
  agent: 'claude',
  paused: false,
  createdAt: at(1, 0),
  folderWorkspaceId: 'home-1',
  lookAround: { on: true, every: 'every-2h', weekdaysOnly: false, focus: '' },
  tidyUp: { on: true, every: 'night' }
} as unknown as Bot

function memoryIo() {
  let text: string | null = null
  return {
    io: { read: () => text, write: async (next: string) => void (text = next) },
    text: () => text
  }
}

const power = {
  settled: () => true,
  checkFullWake: async () => true,
  suspends: () => 0,
  epoch: () => 0,
  awakeNow: () => Date.now(),
  wallNow: () => Date.now(),
  holdAwake: () => () => {}
}

function rig(now: { at: number }, io = memoryIo()) {
  const store = new BotLookAroundStore(io.io, () => {})
  const startConversation = vi.fn(async () => {
    throw new Error('no host in this test')
  })
  const sessions = { startConversation, sendToChat: vi.fn(), release: async () => {} }
  const turnOff = vi.fn(async () => {})
  const watchTurns = async () => ({ next: () => new Promise<never>(() => {}), dispose: () => {} })
  const looks = new BotLookAroundRunner({
    bots: () => [BOT],
    store,
    hadConversation: async () => true,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runner calls only startConversation, sendToChat and release here.
    sessions: sessions as never,
    watchTurns,
    stopTurn: async () => {},
    turnRunning: () => false,
    usageLimitOf: async () => null,
    usageLimitContinues: async () => false,
    turnOff,
    power,
    now: () => now.at
  })
  const tidy = new BotTidyUpRunner({
    bots: () => [BOT],
    store,
    newChats: async () => [
      { title: 'Plans', lines: [{ by: 'owner', text: 'Remember Tuesdays.' }] }
    ],
    busy: () => false,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: tidy-up reads no memory in a run that never starts.
    memory: { change: vi.fn(), history: async () => [] } as never,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: tidy-up reads no files in a run that never starts.
    fs: { readText: async () => '', statFile: async () => null } as never,
    memoryFiles: async () => [],
    homeFolder: () => '/home/fern',
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runner calls only startConversation, sendToChat and release here.
    sessions: sessions as never,
    watchTurns,
    stopTurn: async () => {},
    turnRunning: () => false,
    noteTidied: () => {},
    turnOff,
    power,
    now: () => now.at
  })
  return { store, looks, tidy, startConversation, turnOff, io }
}

/** Arms the bot's looks: its first conversation was before 6 AM on the 2nd. */
function arm(store: BotLookAroundStore): void {
  store.update(BOT.id, (state) => ({ state: { ...state, armedAt: at(2, 5) }, result: null }))
}

describe('pause all over Look around', () => {
  it('skips a due look with the reason, keeps it across a reload, and runs the next slot', async () => {
    const now = { at: at(2, 10, 5) }
    const r = rig(now)
    arm(r.store)
    writeForkPauseAll(true, { by: 'cli' })
    await r.looks.tick()
    expect(r.startConversation).not.toHaveBeenCalled()
    const [skipped] = r.store.get(BOT.id).runs
    expect(skipped).toMatchObject({ paused: true, endedAt: now.at })
    expect(skipped!.error).toContain('Paused by pause-all')
    // Up next says why, without claiming a look happened.
    const shown = upNextState(r.store.get(BOT.id), undefined)
    expect(shown.error).toContain('Paused by pause-all')
    expect(shown.lastLookedAt).toBeUndefined()

    // Resumed in the same slot: nothing catches up.
    writeForkPauseAll(false, { by: 'cli' })
    now.at = at(2, 10, 30)
    await r.looks.tick()
    expect(r.startConversation).not.toHaveBeenCalled()

    // A restart reads the skip back as a skip.
    await r.store.flushed()
    const reloaded = rig(now, r.io)
    expect(reloaded.store.get(BOT.id).runs[0]).toMatchObject({ paused: true })
    now.at = at(2, 12, 5)
    await reloaded.looks.tick()
    await vi.waitFor(() => expect(reloaded.startConversation).toHaveBeenCalledTimes(1))
  })

  it('skips with an unreadable switch, never turns Look around off, and Look now still runs', async () => {
    const now = { at: at(2, 8, 5) }
    const r = rig(now)
    arm(r.store)
    writeFileSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME), '{')
    for (let hour = 8; hour <= 20; hour += 2) {
      now.at = at(2, hour, 5)
      await r.looks.tick()
    }
    for (let hour = 8; hour <= 20; hour += 2) {
      now.at = at(3, hour, 5)
      await r.looks.tick()
    }
    expect(r.startConversation).not.toHaveBeenCalled()
    expect(r.store.get(BOT.id).runs).toHaveLength(14)
    expect(failedLooksInARow(r.store.get(BOT.id))).toBe(0)
    expect(r.turnOff).not.toHaveBeenCalled()

    expect(r.looks.lookNow(BOT.id)).toEqual({ started: true })
    await vi.waitFor(() => expect(r.startConversation).toHaveBeenCalledTimes(1))
  })

  it('starts a due look when not paused', async () => {
    const r = rig({ at: at(2, 10, 5) })
    arm(r.store)
    await r.looks.tick()
    await vi.waitFor(() => expect(r.startConversation).toHaveBeenCalledTimes(1))
  })
})

describe('pause all over Tidy-up', () => {
  it('skips the night with the reason and runs the next night, not at resume', async () => {
    const now = { at: at(2, 3, 30) }
    const r = rig(now)
    writeForkPauseAll(true, { by: 'cli' })
    await r.tidy.tick()
    expect(r.startConversation).not.toHaveBeenCalled()
    const [skipped] = tidyUpState(r.store.get(BOT.id)).runs
    expect(skipped).toMatchObject({ paused: true })
    expect(skipped!.error).toContain('Paused by pause-all')

    writeForkPauseAll(false, { by: 'cli' })
    now.at = at(2, 4, 30)
    await r.tidy.tick()
    expect(r.startConversation).not.toHaveBeenCalled()

    now.at = at(3, 3, 30)
    await r.tidy.tick()
    await vi.waitFor(() => expect(r.startConversation).toHaveBeenCalledTimes(1))
  })

  it('runs the night when not paused', async () => {
    const r = rig({ at: at(2, 3, 30) })
    await r.tidy.tick()
    await vi.waitFor(() => expect(r.startConversation).toHaveBeenCalledTimes(1))
  })
})
