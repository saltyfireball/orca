import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  chatSurviveReadySocketDir,
  refreshChatSurviveLaunchReady,
  resetChatSurviveLaunchReadyForTests
} from './chat-survive-launch-ready'

const dirs: string[] = []

afterEach(() => {
  resetChatSurviveLaunchReadyForTests()
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cslr-'))
  dirs.push(dir)
  return dir
}

describe('chat-survive launch readiness', () => {
  it('has no socket folder before the first check, so the first spawn runs as today', async () => {
    const entry = join(tempDir(), 'entry.js')
    writeFileSync(entry, '')
    expect(chatSurviveReadySocketDir(entry)).toBeNull()
    // That read started a check of its own.
    await refreshChatSurviveLaunchReady(entry)
    expect(chatSurviveReadySocketDir(entry)).toBe(join(tmpdir(), 'orca-chat-survive'))
  })

  it('answers with the checked folder only while the broker entry is on disk', async () => {
    const entry = join(tempDir(), 'entry.js')
    const socketDir = tempDir()
    await refreshChatSurviveLaunchReady(entry, async () => socketDir)
    expect(chatSurviveReadySocketDir(entry)).toBeNull()
    // Let the check that read started finish, so the next one is ours.
    await refreshChatSurviveLaunchReady(entry)
    writeFileSync(entry, '')
    await refreshChatSurviveLaunchReady(entry, async () => socketDir)
    expect(chatSurviveReadySocketDir(entry)).toBe(socketDir)
    // Another entry path was never checked.
    expect(chatSurviveReadySocketDir(join(socketDir, 'other.js'))).toBeNull()
  })

  it('answers null when the socket folder cannot be made private', async () => {
    const entry = join(tempDir(), 'entry.js')
    writeFileSync(entry, '')
    await refreshChatSurviveLaunchReady(entry, async () => null)
    expect(chatSurviveReadySocketDir(entry)).toBeNull()
  })
})
