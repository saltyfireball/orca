// The probe dials a loopback stub server only (127.0.0.1, an ephemeral port); no other host.
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  generateKeyPair,
  publicKeyFromBase64,
  publicKeyToBase64
} from '../../../shared/remote-runtime/e2ee/node/e2ee-crypto'
import { probeEndpointRoute } from './endpoint-failover-probe'

const servers: WebSocketServer[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          for (const client of server.clients) {
            client.close()
          }
          server.close(() => resolve())
        })
    )
  )
})

/** A stub host that holds its own key pair and answers `status.get` once authenticated. */
async function stubServer(): Promise<{
  endpoint: string
  publicKeyB64: string
}> {
  const keys = generateKeyPair()
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  servers.push(wss)
  wss.on('connection', (ws) => {
    let sharedKey: Uint8Array | null = null
    let authenticated = false
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        return
      }
      const frame = data.toString()
      if (!sharedKey) {
        const hello: { publicKeyB64?: string } = JSON.parse(frame)
        if (!hello.publicKeyB64) {
          ws.close(4001, 'Invalid e2ee_hello')
          return
        }
        sharedKey = deriveSharedKey(keys.secretKey, publicKeyFromBase64(hello.publicKeyB64))
        ws.send(JSON.stringify({ type: 'e2ee_ready' }))
        return
      }
      const plaintext = decrypt(frame, sharedKey)
      if (!plaintext) {
        return
      }
      const reply = (message: unknown) => ws.send(encrypt(JSON.stringify(message), sharedKey!))
      if (!authenticated) {
        authenticated = true
        reply({ type: 'e2ee_authenticated' })
        return
      }
      const request = JSON.parse(plaintext) as { id: string }
      reply({
        id: request.id,
        ok: true,
        result: {},
        _meta: { runtimeId: 'stub' }
      })
    })
  })
  await new Promise<void>((resolve) => wss.once('listening', resolve))
  const { port } = wss.address() as AddressInfo
  return {
    endpoint: `ws://127.0.0.1:${port}`,
    publicKeyB64: publicKeyToBase64(keys.publicKey)
  }
}

describe('probeEndpointRoute', () => {
  it('accepts a server whose host key is the pinned one', async () => {
    const server = await stubServer()
    await expect(probeEndpointRoute({ ...server, deviceToken: 'stub-token' }, 3000)).resolves.toBe(
      true
    )
  })

  it('rejects a server answering with a different host key than the pinned one', async () => {
    const server = await stubServer()
    const pinnedElsewhere = publicKeyToBase64(generateKeyPair().publicKey)
    await expect(
      probeEndpointRoute(
        {
          endpoint: server.endpoint,
          deviceToken: 'stub-token',
          publicKeyB64: pinnedElsewhere
        },
        1500
      )
    ).resolves.toBe(false)
  })
})
