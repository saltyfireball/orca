import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnownRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import { readForkServerHealthConfig } from '../../../shared/fork/server-health'
import {
  listForkServerHealth,
  observeForkServerHealth,
  resetForkServerHealthForTests,
  setForkServerHealthNotifyOptionsForTests
} from './server-health-service'
import { serverHealthAlertPayload } from './server-health-alert'
import {
  forkSettingReadOnlyReason,
  isForkSettingSecret
} from '../../../shared/fork/settings-catalog/settings-access'
import type { ServerConnectionReading } from './server-health-tracker'

const ENV = {
  id: 'env-1',
  name: 'build-box',
  source: 'user',
  endpoints: []
} as unknown as KnownRuntimeEnvironment

let desktop: ReturnType<typeof vi.fn<(title: string, body: string) => void>>
let fetchImpl: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  desktop = vi.fn<(title: string, body: string) => void>()
  fetchImpl = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }))
  setForkServerHealthNotifyOptionsForTests({
    desktopNotifier: desktop,
    fetchImpl: fetchImpl as unknown as typeof fetch
  })
})

afterEach(() => {
  resetForkServerHealthForTests()
  vi.restoreAllMocks()
})

function run(
  settings: Partial<ForkGlobalSettings>,
  reading: ServerConnectionReading,
  from: number,
  ms: number
): number {
  let now = from
  for (; now < from + ms; now += 5_000) {
    observeForkServerHealth([ENV], () => reading, settings, now)
  }
  return now
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
  }
}

describe('server health alerts', () => {
  it('reuses the inbox targets by default: desktop when the inbox desktop is on, its webhook', async () => {
    const settings: Partial<ForkGlobalSettings> = {
      forkInboxNotifyDesktop: true,
      forkInboxNotifyWebhookUrl: 'https://hooks.example.test/x'
    }
    let end = run(settings, 'ready', 0, 30_000)
    end = run(settings, 'down', end, 6 * 60_000)
    await settle()
    expect(desktop).toHaveBeenCalledTimes(1)
    expect(desktop.mock.calls[0][0]).toBe('build-box is not answering')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({
      event: 'server-offline',
      server: { id: 'env-1', name: 'build-box' }
    })
    run(settings, 'ready', end, 2 * 60_000)
    await settle()
    expect(desktop).toHaveBeenCalledTimes(2)
    expect(desktop.mock.calls[1][0]).toBe('build-box is back')
    expect(listForkServerHealth().servers[0]).toMatchObject({ state: 'up' })
  })

  it('each target has its own switch, apart from the inbox ones', async () => {
    const settings: Partial<ForkGlobalSettings> = {
      forkInboxNotifyDesktop: false,
      forkServerHealthAlertDesktop: true,
      forkInboxNotifyWebhookUrl: 'https://hooks.example.test/x',
      forkServerHealthAlertWebhook: false
    }
    run(settings, 'down', 0, 6 * 60_000)
    await settle()
    expect(desktop).toHaveBeenCalledTimes(1)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('switched off: nothing is tracked and nothing is sent', async () => {
    const settings = { forkServerHealth: false, forkServerHealthAlertDesktop: true }
    run(settings, 'down', 0, 30 * 60_000)
    await settle()
    expect(desktop).not.toHaveBeenCalled()
    expect(listForkServerHealth().servers).toEqual([])
  })
})

describe('readForkServerHealthConfig', () => {
  it('defaults: on, 5 minutes, 60 s, targets follow the inbox', () => {
    expect(readForkServerHealthConfig({})).toEqual({
      enabled: true,
      offlineMs: 300_000,
      recoveryMs: 60_000,
      alertDesktop: false,
      webhookUrl: null,
      command: null
    })
    expect(readForkServerHealthConfig({ forkInboxNotifyCommand: ' notify.sh ' }).command).toBe(
      'notify.sh'
    )
    expect(
      readForkServerHealthConfig({
        forkInboxNotifyCommand: 'notify.sh',
        forkServerHealthAlertCommand: false
      }).command
    ).toBeNull()
    expect(
      readForkServerHealthConfig({ forkInboxNotifyWebhookUrl: 'file:///x' }).webhookUrl
    ).toBeNull()
  })

  it('a back alert payload carries the downtime in seconds', () => {
    const payload = JSON.parse(
      serverHealthAlertPayload({
        kind: 'recovered',
        environmentId: 'e',
        name: 'n',
        downSince: 0,
        downtimeMs: 15_300_000,
        at: 15_360_000
      })
    )
    expect(payload).toMatchObject({ event: 'server-recovered', downtimeSeconds: 15300 })
  })
})

describe('settings access', () => {
  it('orca settings cannot turn on the command target, and never shows the heartbeat address', () => {
    expect(forkSettingReadOnlyReason('forkServerHealthAlertCommand')).not.toBeNull()
    expect(forkSettingReadOnlyReason('forkInboxNotifyCommand')).not.toBeNull()
    expect(forkSettingReadOnlyReason('forkServerHeartbeatUrl')).toBeNull()
    expect(isForkSettingSecret('forkServerHeartbeatUrl')).toBe(true)
  })
})
