// Pause all (BAD-685): the persisted switch against a real folder. A missing file is not paused;
// a file that cannot be parsed is paused; releasing removes the file.
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ userData: '', installed: true }))
vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => paths.userData }),
  hasAppEnvironment: () => paths.installed
}))

import {
  PAUSE_ALL_STATE_FILE_NAME,
  forkPauseAllRefusal,
  isForkPauseAllEngaged,
  onForkPauseAllChanged,
  readForkPauseAll,
  resetForkPauseAllCacheForTests,
  writeForkPauseAll
} from './pause-all-state'

beforeEach(() => {
  paths.userData = mkdtempSync(join(tmpdir(), 'pause-all-'))
  paths.installed = true
  resetForkPauseAllCacheForTests()
})
afterEach(() => {
  rmSync(paths.userData, { recursive: true, force: true })
})

const file = (): string => join(paths.userData, PAUSE_ALL_STATE_FILE_NAME)

describe('the pause-all switch', () => {
  it('is off with no file and with no app environment', () => {
    expect(isForkPauseAllEngaged()).toBe(false)
    expect(forkPauseAllRefusal()).toBeNull()
    paths.installed = false
    writeFileSync(file(), 'junk')
    expect(isForkPauseAllEngaged()).toBe(false)
  })

  it('engages, keeps its first time and author, and releases by removing the file', () => {
    const first = writeForkPauseAll(true, { by: 'cli', note: 'window', now: 100 })
    expect(first).toMatchObject({ engaged: true, since: 100, by: 'cli', note: 'window' })
    expect(statSync(file()).mode & 0o777).toBe(0o600)
    expect(isForkPauseAllEngaged()).toBe(true)
    expect(forkPauseAllRefusal()).toContain('Paused by pause-all')
    const again = writeForkPauseAll(true, { by: 'paired', now: 900 })
    expect(again).toMatchObject({ since: 100, by: 'cli', note: 'window' })
    writeForkPauseAll(false, { by: 'cli' })
    expect(isForkPauseAllEngaged()).toBe(false)
    expect(() => statSync(file())).toThrow()
  })

  it('counts a damaged file as engaged, and resume clears it', () => {
    writeFileSync(file(), '{ broken')
    const state = readForkPauseAll()
    expect(state).toMatchObject({ engaged: true, corrupt: true })
    expect(forkPauseAllRefusal()).toContain('counts as engaged')
    writeForkPauseAll(false, { by: 'cli' })
    expect(isForkPauseAllEngaged()).toBe(false)
  })

  it('counts a file it cannot read as engaged', () => {
    // A directory where the file belongs: stat works, reading fails.
    rmSync(paths.userData, { recursive: true, force: true })
    paths.userData = mkdtempSync(join(tmpdir(), 'pause-all-'))
    writeFileSync(join(paths.userData, 'x'), '')
    mkdirSync(file())
    expect(readForkPauseAll()).toMatchObject({ engaged: true, corrupt: true })
  })

  it('sees an edit made by another process, and tells listeners about a change', () => {
    const seen: boolean[] = []
    onForkPauseAllChanged((state) => seen.push(state.engaged))
    writeForkPauseAll(true, { by: 'app' })
    writeFileSync(file(), JSON.stringify({ version: 1, engaged: false }))
    expect(isForkPauseAllEngaged()).toBe(false)
    writeForkPauseAll(false, { by: 'app' })
    expect(seen).toEqual([true, false])
  })
})
