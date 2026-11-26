// Letters under Pause all (BAD-818): the real runner and delivery pass, the real letters store and the
// real switch in a temporary data folder. While paused nothing is typed into an idle chat or terminal
// agent (also with an unreadable switch), the sender's receipt says the letter is held, and none
// expires however long the pause; resume-all delivers at once and gives what is left a new day.
// Faked: the chat and terminal ports (the letters test kit), so a send is recorded, not typed.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => paths.userData }),
  hasAppEnvironment: () => true
}))

import { formatLetterList } from '../../../cli/fork/letters-format'
import { formatLetterSent } from '../../../shared/fork/letters-receipt'
import {
  PAUSE_ALL_STATE_FILE_NAME,
  resetForkPauseAllCacheForTests,
  writeForkPauseAll
} from '../pause-all/pause-all-state'
import { runForkLetterDeliveryPass } from './letters-delivery'
import { createForkLettersRunner, type ForkLettersRunner } from './letters-runner'
import { listForkLetters, sendForkLetter } from './letters-service'
import { fakeLetters, idle } from './letters-test-kit'

const from = { via: 'local' as const, claim: { sessionId: 'aaaa1111' } }
const HOUR = 60 * 60_000

let runner: ForkLettersRunner | null = null

beforeEach(() => {
  paths.userData = mkdtempSync(join(tmpdir(), 'letters-pause-all-'))
  resetForkPauseAllCacheForTests()
})
afterEach(() => {
  runner?.stop()
  runner = null
  resetForkPauseAllCacheForTests()
  rmSync(paths.userData, { recursive: true, force: true })
})

function pass(fake: ReturnType<typeof fakeLetters>): Promise<number> {
  return runForkLetterDeliveryPass(fake.deps.store, fake.deps.ports(), fake.deps.now)
}

async function only(fake: ReturnType<typeof fakeLetters>, chat: string) {
  return (await listForkLetters(fake.deps, chat)).letters[0]!
}

describe('letters while paused', () => {
  it('holds a letter to an idle chat and an idle terminal agent, and resume-all delivers them at once', async () => {
    const fake = fakeLetters()
    // Sent before the pause, so only a pass the runner makes while paused notes the hold.
    await sendForkLetter(fake.deps, { to: 'bbbb2222', text: 'hello' }, from)
    await sendForkLetter(fake.deps, { to: 'pane-key:1', text: 'hi pane' }, from)
    expect((await only(fake, 'bbbb2222')).note).toBeNull()
    writeForkPauseAll(true, { by: 'cli' })
    fake.facts.set('bbbb2222', idle)

    runner = createForkLettersRunner(fake.deps)
    runner.kick()
    await vi.waitFor(async () =>
      expect((await only(fake, 'pane-key:1')).note).toContain('Paused by pause-all')
    )
    expect(fake.sent).toEqual([])
    const held = await only(fake, 'bbbb2222')
    expect(held).toMatchObject({ state: 'queued' })
    expect(held.note).toContain('Paused by pause-all')
    expect(formatLetterList(await listForkLetters(fake.deps, 'bbbb2222'))).toContain(
      'queued (pause-all)'
    )

    // resume-all: the runner's next pass is 5 s away; the release runs one now.
    writeForkPauseAll(false, { by: 'cli' })
    await vi.waitFor(
      () => expect(fake.sent.map((s) => s.to).sort()).toEqual(['bbbb2222', 'h-pane-key:1']),
      { timeout: 2000 }
    )
    expect(await only(fake, 'bbbb2222')).toMatchObject({ state: 'delivered', note: null })
  })

  it("tells the sender a letter sent while paused is held, and one sent after it isn't", async () => {
    const fake = fakeLetters()
    writeForkPauseAll(true, { by: 'cli' })
    const paused = await sendForkLetter(fake.deps, { to: 'bbbb2222', text: 'hello' }, from)
    expect(formatLetterSent(paused)).toContain(
      'held by pause-all: delivered after `orca resume-all`'
    )
    writeForkPauseAll(false, { by: 'cli' })
    const running = await sendForkLetter(fake.deps, { to: 'bbbb2222', text: 'again' }, from)
    expect(formatLetterSent(running)).toContain('queued: delivered when the chat ends its turn')
  })

  for (const to of ['bbbb2222', 'pane-key:1']) {
    it(`holds a letter to ${to} when the switch is engaged during the send, before anything is typed`, async () => {
      const fake = fakeLetters()
      fake.facts.set('bbbb2222', idle)
      const ports = fake.deps.ports()
      const engage = () => writeForkPauseAll(true, { by: 'cli' })
      fake.deps.ports = () => ({
        chat: { ...ports.chat, send: (...args) => (engage(), ports.chat.send(...args)) },
        terminal: {
          ...ports.terminal,
          send: (...args) => (engage(), ports.terminal.send(...args))
        }
      })
      await sendForkLetter(fake.deps, { to, text: 'hello' }, from)
      expect(await pass(fake)).toBe(1)
      expect(fake.sent).toEqual([])
      expect(await pass(fake)).toBe(1)
      expect((await only(fake, to)).note).toContain('Paused by pause-all')
    })
  }

  it('holds with an unreadable switch', async () => {
    const fake = fakeLetters()
    fake.facts.set('bbbb2222', idle)
    await sendForkLetter(fake.deps, { to: 'bbbb2222', text: 'hello' }, from)
    writeFileSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME), '{ broken')
    resetForkPauseAllCacheForTests()
    expect(await pass(fake)).toBe(1)
    expect(fake.sent).toEqual([])
    expect((await only(fake, 'bbbb2222')).note).toContain('could not be read')
  })

  it('expires nothing it holds, and gives a letter a new day once released', async () => {
    const fake = fakeLetters()
    fake.facts.set('bbbb2222', { ...idle, inTurn: true })
    await sendForkLetter(fake.deps, { to: 'bbbb2222', text: 'late' }, from)
    await pass(fake)
    writeForkPauseAll(true, { by: 'cli' })
    fake.advance(30 * HOUR)
    expect(await pass(fake)).toBe(1)
    expect(await only(fake, 'bbbb2222')).toMatchObject({ state: 'queued' })

    writeForkPauseAll(false, { by: 'cli' })
    // The recipient is still in a turn at resume: the letter waits, and its day starts now.
    expect(await pass(fake)).toBe(1)
    expect(await only(fake, 'bbbb2222')).toMatchObject({
      state: 'queued',
      note: 'the chat is in a turn'
    })
    fake.advance(23 * HOUR)
    expect(await pass(fake)).toBe(1)
    fake.advance(2 * HOUR)
    expect(await pass(fake)).toBe(0)
    expect(await only(fake, 'bbbb2222')).toMatchObject({ state: 'expired' })
    expect(fake.sent).toEqual([])
  })
})
