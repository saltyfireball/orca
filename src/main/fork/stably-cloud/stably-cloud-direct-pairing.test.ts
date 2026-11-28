// Upstream cloud switch (BAD-896): with the switch off, a phone still pairs over the network
// directly. A real RPC server, a real pairing offer and a real encrypted client connection; no
// request goes to an upstream host and the offer carries no relay.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'
import { pairedRuntimeConnectionFromOffer } from '../../../shared/remote-runtime/pairing/paired-runtime-connection'
import { RemoteRuntimeSharedControlConnection } from '../../../shared/remote-runtime/control/remote-runtime-shared-control-connection'
import { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { OrcaRuntimeRpcServer } from '../../runtime/rpc/server/runtime-rpc'
import { STATUS_METHODS } from '../../runtime/rpc/methods/host-management/status'
import { getOrcaCloudAuthConfig } from '../../orca-profiles/cloud-auth/profile-cloud-auth-config'
import { installForkStablyCloudSource } from './stably-cloud-source'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup()
  }
  installForkStablyCloudSource(() => undefined)
  vi.unstubAllGlobals()
})

describe('direct pairing with upstream cloud services off', () => {
  it('connects a client to the host and answers a request, with no relay and no upstream call', async () => {
    installForkStablyCloudSource(() => ({ forkStablyCloudEnabled: false }))
    expect(getOrcaCloudAuthConfig({}).configured).toBe(false)
    const outbound = vi.fn(globalThis.fetch)
    vi.stubGlobal('fetch', outbound)

    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-stably-cloud-pair-'))
    const server = new OrcaRuntimeRpcServer({
      runtime: new OrcaRuntimeService(),
      userDataPath,
      enableWebSocket: true,
      wsPort: 0,
      methods: STATUS_METHODS
    })
    await server.start()
    cleanups.push(async () => {
      await server.stop().catch(() => {})
      rmSync(userDataPath, { recursive: true, force: true })
    })

    const offer = server.createPairingOffer({
      address: '127.0.0.1',
      scope: 'runtime',
      name: 'Test phone'
    })
    if (!offer.available) {
      throw new Error('direct pairing unavailable')
    }
    const parsed = parsePairingCode(offer.pairingUrl)
    expect(parsed).not.toBeNull()
    expect(parsed).not.toHaveProperty('relay')
    expect(offer.pairingUrl).not.toMatch(/orca\.dev/)

    const client = new RemoteRuntimeSharedControlConnection(
      pairedRuntimeConnectionFromOffer(parsed!)
    )
    cleanups.push(() => client.close())
    expect((await client.request('status.get', { probe: true }, 5_000)).ok).toBe(true)
    expect(outbound).not.toHaveBeenCalled()
  })
})
