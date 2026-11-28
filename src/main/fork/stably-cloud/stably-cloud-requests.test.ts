// Upstream cloud switch (BAD-896): through the real entry points of each hosted upstream service,
// a build with the switch off sends no request to an upstream host, and the same call with the
// switch on does reach it (so the spies are proven to see these requests).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const netFetch = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '1.0.0' },
  net: { fetch: netFetch }
}))

import { installFakeAppEnvironment } from '../../../../config/scripts/test-runtime/environment/vitest-host-ports-setup'
import { FORK_STABLY_CLOUD_OFF_MESSAGE } from '../../../shared/fork/stably-cloud'
import { resolveArtifactCloudApiUrl } from '../../artifacts/artifact-cloud-config'
import { connectCurrentOrcaProfile } from '../../orca-profiles/cloud-auth/profile-cloud-service'
import { getOrcaPushGatewayUrl } from '../../orca-profiles/cloud-auth/profile-cloud-auth-config'
import { PluginKillListService } from '../../plugins/catalog/plugin-kill-list-service'
import { fetchPluginInstallStats } from '../../plugins/catalog/plugin-install-stats-service'
import { createPushHostKeypair } from '../../runtime/push/push-host-challenge-fixtures'
import { PushGatewayClient } from '../../runtime/push/push-gateway-client'
import { fetchNudge } from '../../updater/nudges/nudge-campaign'
import { fetchChangelog } from '../../updater/releases/updater-changelog'
import { installForkStablyCloudSource } from './stably-cloud-source'

const UPSTREAM_HOST = /(^|\.)(onorca\.dev|orca\.dev)$/

const globalFetch = vi.fn()

function upstreamRequests(): string[] {
  return [...netFetch.mock.calls, ...globalFetch.mock.calls]
    .map((call) => String(call[0] instanceof Request ? call[0].url : call[0]))
    .filter((url) => UPSTREAM_HOST.test(new URL(url).hostname))
}

function switchIs(value: boolean | undefined): void {
  installForkStablyCloudSource(() => ({ forkStablyCloudEnabled: value }))
}

let userDataPath = ''

beforeEach(() => {
  netFetch.mockReset()
  globalFetch.mockReset()
  netFetch.mockResolvedValue(new Response('[]', { status: 200 }))
  globalFetch.mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', globalFetch)
  installFakeAppEnvironment({ isPackaged: () => true })
  userDataPath = mkdtempSync(join(tmpdir(), 'orca-stably-cloud-'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  installFakeAppEnvironment()
  switchIs(undefined)
  rmSync(userDataPath, { recursive: true, force: true })
})

async function pushRegister(): Promise<unknown> {
  const client = new PushGatewayClient({
    gatewayUrl: getOrcaPushGatewayUrl({}),
    keypair: createPushHostKeypair()
  })
  return client.registerDevice({ deviceId: 'd1', platform: 'ios', token: 'tok' })
}

async function killListRefresh(): Promise<unknown> {
  const service = new PluginKillListService({ pluginsDataDir: userDataPath })
  return service.refresh().catch((error: Error) => error)
}

describe('with the switch off no request reaches an upstream host', () => {
  it('sign-in opens no browser page and makes no request', async () => {
    switchIs(false)
    const openBrowser = vi.fn(async (_url: string) => {})
    const result = await connectCurrentOrcaProfile(userDataPath, openBrowser)
    expect(result.status).toBe('unconfigured')
    expect(result.auth.setupMessage).toBe(FORK_STABLY_CLOUD_OFF_MESSAGE)
    expect(openBrowser).not.toHaveBeenCalled()
    expect(upstreamRequests()).toEqual([])
  })

  it('the phone push client, the feeds and the plugin lists send nothing', async () => {
    switchIs(false)
    await pushRegister()
    expect(await fetchNudge()).toBeNull()
    expect(await fetchChangelog('1.0.1', '1.0.0')).toBeNull()
    expect(await killListRefresh()).toEqual(new Error(FORK_STABLY_CLOUD_OFF_MESSAGE))
    await expect(fetchPluginInstallStats()).rejects.toThrow(FORK_STABLY_CLOUD_OFF_MESSAGE)
    expect(netFetch).not.toHaveBeenCalled()
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('share links have no address to call', () => {
    switchIs(false)
    expect(() => resolveArtifactCloudApiUrl()).toThrow(FORK_STABLY_CLOUD_OFF_MESSAGE)
  })

  it('a push client built while the switch was on stops at the switch', async () => {
    switchIs(true)
    const client = new PushGatewayClient({
      gatewayUrl: getOrcaPushGatewayUrl({}),
      keypair: createPushHostKeypair()
    })
    switchIs(false)
    await client.registerDevice({ deviceId: 'd1', platform: 'ios', token: 'tok' })
    expect(globalFetch).not.toHaveBeenCalled()
  })
})

describe('with the switch on the same calls do reach upstream hosts', () => {
  it('sign-in opens upstream’s sign-in page', async () => {
    switchIs(true)
    const openBrowser = vi.fn(async (_url: string) => {
      throw new Error('stop here')
    })
    await connectCurrentOrcaProfile(userDataPath, openBrowser)
    expect(openBrowser).toHaveBeenCalledTimes(1)
    expect(new URL(openBrowser.mock.calls[0]![0]).hostname).toBe('login.onorca.dev')
  })

  it('the push client, the feeds and the plugin lists make requests', async () => {
    switchIs(true)
    await pushRegister()
    await fetchNudge()
    await fetchChangelog('1.0.1', '1.0.0').catch(() => null)
    await killListRefresh()
    await fetchPluginInstallStats().catch(() => null)
    const hosts = new Set(upstreamRequests().map((url) => new URL(url).hostname))
    expect(hosts).toEqual(new Set(['push.onorca.dev', 'orca.dev']))
    expect(resolveArtifactCloudApiUrl()).toBe('https://share.onorca.dev')
  })

  it('an unset setting follows the build default, which is on in tests and off in a stock fork build', async () => {
    switchIs(undefined)
    expect(resolveArtifactCloudApiUrl()).toBe('https://share.onorca.dev')
  })
})
