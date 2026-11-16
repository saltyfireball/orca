import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceEntry } from '../../runtime/rpc/server/pairing/device-entry'
import type { DeviceRegistry } from '../../runtime/rpc/server/pairing/device-registry'
import {
  approveForkDevice,
  attachForkDeviceApproval,
  denyForkDevice,
  forkDeviceApprovalWait,
  listForkPairedDevices
} from './device-approval-service'
import { DEVICE_APPROVALS_FILE } from './device-approval-store'

function row(deviceId: string, extra: Partial<DeviceEntry> = {}): DeviceEntry {
  return { deviceId, name: deviceId, scope: 'runtime', pairedAt: 1, lastSeenAt: 1, ...extra }
}

function setup(rows: DeviceEntry[], dir: string) {
  const devices = [...rows]
  const settings = { forkDeviceApproval: false }
  const registry = {
    getDevice: (id: string) => devices.find((entry) => entry.deviceId === id) ?? null,
    listDevices: () => devices
  } as unknown as DeviceRegistry
  const server = {
    getDeviceRegistry: () => registry,
    revokeMobileDevice: vi.fn(async () => true),
    revokeRuntimeAccess: vi.fn((id: string) => {
      devices.splice(
        devices.findIndex((entry) => entry.deviceId === id),
        1
      )
      return true
    })
  }
  attachForkDeviceApproval(server, {
    userDataPath: dir,
    runtime: { requireStore: () => ({ getSettings: () => settings }) }
  })
  return { devices, settings, server }
}

describe('device approval', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fork-device-approval-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps devices paired before the update and holds a new pairing until approved', () => {
    const laptop = row('laptop')
    const offer = row('offer', { lastSeenAt: 0 })
    const { settings, server } = setup([laptop, offer], dir)
    settings.forkDeviceApproval = true

    expect(forkDeviceApprovalWait(server, laptop, 'worktree.list')).toBeNull()

    // The leaked link's holder signs in: it may finish pairing but nothing else.
    offer.lastSeenAt = 5
    expect(forkDeviceApprovalWait(server, offer, 'status.get')).toBeNull()
    const refusal = forkDeviceApprovalWait(server, offer, 'terminal.create')
    const code = /approval code is ([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(refusal ?? '')?.[1]
    expect(code).toBeDefined()
    expect(listForkPairedDevices().devices.find((d) => d.deviceId === 'offer')).toMatchObject({
      status: 'waiting',
      code
    })

    // A re-keyed install of the same pairing waits with it, then is approved with it.
    const fork = row('offer-key', { forkedFrom: 'offer' })
    expect(forkDeviceApprovalWait(server, fork, 'terminal.create')).toContain(code)
    approveForkDevice(code!.toLowerCase().replace('-', ''))
    expect(forkDeviceApprovalWait(server, offer, 'terminal.create')).toBeNull()
    expect(forkDeviceApprovalWait(server, fork, 'terminal.create')).toBeNull()
  })

  it('approves devices that sign in while approval is off, so turning it on keeps them', () => {
    const phone = row('phone', { lastSeenAt: 0, scope: 'mobile' })
    const { settings, devices, server } = setup([], dir)
    // The file now exists with nobody in it; the phone pairs afterwards.
    expect(listForkPairedDevices().devices).toEqual([])
    devices.push(phone)
    phone.lastSeenAt = 9
    expect(forkDeviceApprovalWait(server, phone, 'session.list')).toBeNull()
    settings.forkDeviceApproval = true
    expect(forkDeviceApprovalWait(server, phone, 'session.list')).toBeNull()
  })

  it('deny removes only a waiting pairing', async () => {
    const laptop = row('laptop')
    const stranger = row('stranger', { lastSeenAt: 0 })
    const { settings, server } = setup([laptop, stranger], dir)
    settings.forkDeviceApproval = true
    // The first request after the update records who was already paired.
    expect(forkDeviceApprovalWait(server, laptop, 'worktree.list')).toBeNull()
    stranger.lastSeenAt = 3
    forkDeviceApprovalWait(server, stranger, 'terminal.create')

    await expect(denyForkDevice('laptop')).rejects.toThrow(/not waiting/)
    await denyForkDevice('stranger')
    expect(server.revokeRuntimeAccess).toHaveBeenCalledWith('stranger')
    expect(listForkPairedDevices().devices.map((d) => d.deviceId)).toEqual(['laptop'])
  })

  it('an unreadable approvals file approves nobody instead of starting over', () => {
    writeFileSync(join(dir, DEVICE_APPROVALS_FILE), '{not json')
    const laptop = row('laptop')
    const { settings, server } = setup([laptop], dir)
    settings.forkDeviceApproval = true
    expect(forkDeviceApprovalWait(server, laptop, 'worktree.list')).toMatch(/waiting for approval/)
  })
})
