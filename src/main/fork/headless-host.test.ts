// The fork's installs on a host with no desktop app, on fakes: no timer fires and no chat is read.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installForkHeadlessHost } from './headless-host'
import { uninstallForkMcpProfilesForTests } from './mcp-profiles/mcp-profiles-service'
import { uninstallForkAgentProfileLaunchForTests } from './agent-profiles/agent-profile-launch-scope'
import {
  forkIsHeadlessSettingsHost,
  forkMarkHeadlessSettingsHost
} from './settings-cli/settings-cli-headless'

let userData = ''

afterEach(() => {
  forkMarkHeadlessSettingsHost(false)
  uninstallForkMcpProfilesForTests()
  uninstallForkAgentProfileLaunchForTests()
  vi.useRealTimers()
  rmSync(userData, { recursive: true, force: true })
})

describe('installForkHeadlessHost', () => {
  it('marks the host for settings writes and watches the store for the compaction mode', async () => {
    userData = mkdtempSync(join(tmpdir(), 'headless-host-'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
    const listeners: ((updates: Record<string, unknown>) => void)[] = []
    const getSettings = vi.fn(() => ({}))
    const store = {
      getSettings,
      onSettingsChanged: (listener: (updates: Record<string, unknown>) => void) => {
        listeners.push(listener)
      }
    }
    expect(forkIsHeadlessSettingsHost()).toBe(false)

    const stop = await installForkHeadlessHost(store, userData)

    expect(forkIsHeadlessSettingsHost()).toBe(true)
    expect(listeners).toHaveLength(1)
    // The compaction sweep, the heartbeat (SLRM-2311), which reads its settings when it fires, and
    // the PR babysitter's wait check (SLRM-2386), which reads nothing before a PR is babysat.
    expect(vi.getTimerCount()).toBe(3)
    // Nothing is read until the first sweep or heartbeat is due.
    expect(getSettings).not.toHaveBeenCalled()
    await stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
