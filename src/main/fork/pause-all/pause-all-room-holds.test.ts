// Pause all over bot room hand-offs (BAD-818): the real room store (SQLite), BotGroupRuntime and
// hand-off, with the real switch in a temporary data folder. A reply naming another member wakes
// nobody while paused (also with an unreadable switch), is kept across a restart, and goes on once
// at resume-all; a person's post still starts its turns.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => paths.userData }),
  hasAppEnvironment: () => true
}))

import { startBotGroupsSoon } from '../../bots/bot-group-runtime'
import { room } from '../bot-room-hops/bot-room-hops-test-room'
import { countPauseAllRoomHolds } from './pause-all-room-hold-store'
import { releaseForkPauseAllRoomHolds } from './pause-all-room-release'
import {
  PAUSE_ALL_STATE_FILE_NAME,
  resetForkPauseAllCacheForTests,
  writeForkPauseAll
} from './pause-all-state'

beforeEach(() => {
  paths.userData = mkdtempSync(join(tmpdir(), 'pause-all-room-'))
  resetForkPauseAllCacheForTests()
})
afterEach(() => {
  rmSync(paths.userData, { recursive: true, force: true })
})

describe('pause all over bot room hand-offs', () => {
  it('holds a hand-off while paused and lets it go on once at resume-all', async () => {
    const r = room({})
    r.post('post-1', ['bot-a'])
    writeForkPauseAll(true, { by: 'cli' })
    expect(await r.reply('post-1', 'bot-a', '@Bo take the next step.')).toEqual([])
    expect(r.turnOn('post-1').handedOff).toEqual([])
    expect(countPauseAllRoomHolds(r.db)).toBe(1)
    // A replayed end of the same turn wakes no one either.
    expect(await r.reply('post-1', 'bot-a', '@Bo take the next step.')).toEqual([])

    writeForkPauseAll(false, { by: 'cli' })
    await vi.waitFor(() => expect(r.wokenBy(r.turnOn('post-1').operationId)).toHaveLength(1))
    await r.settled()
    expect(r.wokenBy(r.turnOn('post-1').operationId)[0]!.turns[0]!.botId).toBe('bot-b')
    expect(countPauseAllRoomHolds(r.db)).toBe(0)
    // A second release wakes nobody twice.
    expect(await releaseForkPauseAllRoomHolds(r.groups)).toBe(0)
    expect(r.wokenBy(r.turnOn('post-1').operationId)).toHaveLength(1)
  })

  it('holds with an unreadable switch, and a restart keeps the hold for a release at start', async () => {
    const first = room({})
    first.post('post-1', ['bot-a'])
    writeFileSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME), 'not json')
    expect(await first.reply('post-1', 'bot-a', '@Cy have a look.')).toEqual([])
    expect(countPauseAllRoomHolds(first.db)).toBe(1)

    // The app stops; the switch is released while it is down; a new runtime opens the same database.
    rmSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME))
    resetForkPauseAllCacheForTests()
    const again = room({}, first.db)
    expect(await releaseForkPauseAllRoomHolds(again.groups)).toBe(1)
    await again.settled()
    expect(again.wokenBy(again.turnOn('post-1').operationId).map((l) => l.turns[0]!.botId)).toEqual(
      ['bot-c']
    )
  })

  it('releases a kept hold through the real start', async () => {
    const first = room({})
    first.post('post-1', ['bot-a'])
    writeForkPauseAll(true, { by: 'cli' })
    expect(await first.reply('post-1', 'bot-a', '@Bo have a look.')).toEqual([])
    rmSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME))
    resetForkPauseAllCacheForTests()
    const again = room({}, first.db)
    startBotGroupsSoon(again.runtime, () => true)
    await vi.waitFor(() =>
      expect(again.wokenBy(again.turnOn('post-1').operationId)).toHaveLength(1)
    )
    expect(countPauseAllRoomHolds(again.db)).toBe(0)
  })

  it('wakes as usual when not paused, and a person post still starts its turn while paused', async () => {
    const r = room({})
    r.post('post-1', ['bot-a'])
    expect(await r.reply('post-1', 'bot-a', '@Bo over to you.')).toHaveLength(1)
    expect(countPauseAllRoomHolds(r.db)).toBe(0)

    writeForkPauseAll(true, { by: 'cli' })
    const post = r.post('post-2', ['bot-b'])
    // The post's own turn is stored to deliver: nothing holds a person's post.
    expect(r.groups.store.message(post.id)!.turns.map((turn) => turn.botId)).toEqual(['bot-b'])
    expect(countPauseAllRoomHolds(r.db)).toBe(0)
  })
})
