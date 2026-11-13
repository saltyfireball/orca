import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ entry: '', userData: '' }))

vi.mock('../../worker-threads/forked-child-entry-path', () => ({
  getForkedChildEntryPath: () => paths.entry
}))
vi.mock('../../../shared/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => paths.userData })
}))

const { installForkChatSurvive } = await import('./chat-survive-setting')
const { chatSurviveReadySocketDir, resetChatSurviveLaunchReadyForTests } =
  await import('./chat-survive-launch-ready')

const dirs: string[] = []

afterEach(() => {
  resetChatSurviveLaunchReadyForTests()
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('installForkChatSurvive', () => {
  it('resolves after the first readiness check when the setting is on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'csset-'))
    dirs.push(dir)
    paths.entry = join(dir, 'entry.js')
    paths.userData = join(dir, 'user-data')
    writeFileSync(paths.entry, '')
    await installForkChatSurvive({
      getSettings: () => ({ forkChatSurvive: true }) as never,
      onSettingsChanged: () => () => {}
    })
    // The first spawn after install already has an answer.
    expect(chatSurviveReadySocketDir(paths.entry)).not.toBeNull()
  })
})
