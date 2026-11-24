// SLRM-2271 (FORK.md "Device approval"): the gate every paired device's request passes, and the
// list, approve, deny and revoke actions behind `orca devices` and the Settings card.
import type { DeviceEntry } from '../../runtime/rpc/server/pairing/device-entry'
import type { DeviceRegistry } from '../../runtime/rpc/server/pairing/device-registry'
import {
  forkDeviceApprovalEnabled,
  type ForkDeviceActionResult,
  type ForkDeviceApprovalStatus,
  type ForkDeviceListResult
} from '../../../shared/fork/device-approval'
import { EXCHANGE_PAIRING_TICKET_METHOD } from '../../../shared/remote-runtime/pairing/ticket-exchange-capability'
import { REGISTER_DEVICE_KEY_METHOD } from '../../../shared/remote-runtime/pairing/device-key-capability'
import { DeviceApprovalStore } from './device-approval-store'
import { errorResponse } from '../../runtime/rpc/responses/rpc-response'
import { FORK_DEVICE_APPROVAL_PENDING_CODE } from '../../../shared/fork/device-approval'

export type DeviceApprovalServer = {
  getDeviceRegistry(): DeviceRegistry | null
  revokeMobileDevice(deviceId: string): Promise<boolean>
  revokeRuntimeAccess(deviceId: string): boolean
}

type ApprovalHost = {
  server: DeviceApprovalServer
  store: DeviceApprovalStore
  enabled: () => boolean
}

// What a waiting device may still do: finish its own pairing and see that the host is there.
const WAITING_DEVICE_METHODS: ReadonlySet<string> = new Set([
  'status.get',
  'runtime.clientCapabilities.update',
  EXCHANGE_PAIRING_TICKET_METHOD,
  REGISTER_DEVICE_KEY_METHOD
])

const hosts = new WeakMap<WeakKey, ApprovalHost>()
let activeHost: ApprovalHost | null = null

/** One hook in the RPC server's constructor; the last server made answers `orca devices`. */
export function attachForkDeviceApproval(
  server: DeviceApprovalServer,
  options: { userDataPath: string; runtime: { requireStore(): { getSettings(): unknown } } }
): void {
  // Why: until settings can be read, assume approval is on, so an unknown device is never let in.
  let lastKnown = true
  const host: ApprovalHost = {
    server,
    store: new DeviceApprovalStore(options.userDataPath),
    enabled: () => {
      try {
        lastKnown = forkDeviceApprovalEnabled(
          options.runtime.requireStore().getSettings() as { forkDeviceApproval?: boolean }
        )
      } catch {
        // No settings store yet: keep the last answer.
      }
      return lastKnown
    }
  }
  hosts.set(server, host)
  activeHost = host
}

/** The device, then whatever it was paired through, up to the row its pairing started from. */
function lineage(registry: DeviceRegistry, device: DeviceEntry): DeviceEntry[] {
  const chain = [device]
  const seen = new Set([device.deviceId])
  let current = device
  for (;;) {
    const nextId = current.forkedFrom ?? current.parentDeviceId
    const next = nextId && !seen.has(nextId) ? registry.getDevice(nextId) : null
    if (!next) {
      return chain
    }
    chain.push(next)
    seen.add(next.deviceId)
    current = next
  }
}

function prepare(host: ApprovalHost): DeviceRegistry | null {
  const registry = host.server.getDeviceRegistry()
  if (registry) {
    host.store.baselineOnce(() =>
      registry
        .listDevices()
        .filter((row) => row.lastSeenAt > 0 && !row.ephemeral)
        .map((row) => row.deviceId)
    )
  }
  return registry
}

function waitingMessage(code: string): string {
  return `This device is waiting for approval. Its approval code is ${code}. On the server run "orca devices approve ${code}", or approve it in Settings > Blackfish > Device approval on a device that is already approved.`
}

/** Null lets the request through; a string is the refusal a waiting device is shown. */
export function forkDeviceApprovalWait(
  server: WeakKey,
  device: DeviceEntry,
  method: string
): string | null {
  const host = hosts.get(server)
  const registry = host && prepare(host)
  if (!host || !registry) {
    return null
  }
  const chain = lineage(registry, device)
  if (chain.some((row) => host.store.isTrusted(row.deviceId))) {
    return null
  }
  const root = chain.at(-1) ?? device
  if (!host.enabled()) {
    // Why: a device that signed in while approval was off was let in; turning it on keeps it.
    host.store.trust(root.deviceId)
    return null
  }
  const pending = host.store.recordAttempt(root.deviceId, Date.now())
  return WAITING_DEVICE_METHODS.has(method) ? null : waitingMessage(pending.code)
}

/** The reply a waiting device is sent for its request, or null to let the request through. */
export function forkDeviceApprovalRefusal(
  server: WeakKey,
  device: DeviceEntry,
  request: { id: string; method: string },
  runtimeId: string
): string | null {
  const wait = forkDeviceApprovalWait(server, device, request.method)
  return wait
    ? JSON.stringify(
        errorResponse(request.id, { runtimeId }, FORK_DEVICE_APPROVAL_PENDING_CODE, wait)
      )
    : null
}

function requireHost(): { host: ApprovalHost; registry: DeviceRegistry } {
  const host = activeHost
  const registry = host && prepare(host)
  if (!host || !registry) {
    throw new Error('This host does not accept paired devices, so it has none to approve.')
  }
  return { host, registry }
}

function statusOf(
  host: ApprovalHost,
  registry: DeviceRegistry,
  row: DeviceEntry
): ForkDeviceApprovalStatus {
  const chain = lineage(registry, row)
  if (chain.some((entry) => host.store.isTrusted(entry.deviceId))) {
    return 'approved'
  }
  if (host.store.pendingFor((chain.at(-1) ?? row).deviceId)) {
    return 'waiting'
  }
  return row.lastSeenAt === 0 ? 'unused-link' : 'not-approved'
}

export function listForkPairedDevices(): ForkDeviceListResult {
  const { host, registry } = requireHost()
  host.store.prunePending((id) => registry.getDevice(id) !== null)
  const devices = registry
    .listDevices()
    .filter((row) => !row.ephemeral)
    .map((row) => {
      const status = statusOf(host, registry, row)
      const code = status === 'waiting' ? host.store.pendingFor(row.deviceId)?.code : undefined
      const via = row.forkedFrom ?? row.parentDeviceId
      return {
        deviceId: row.deviceId,
        name: row.name,
        scope: row.scope,
        status,
        ...(code ? { code } : {}),
        pairedAt: row.pairedAt,
        lastSeenAt: row.lastSeenAt,
        ...(via ? { via } : {})
      }
    })
  return { enabled: host.enabled(), devices }
}

/** A code picks the waiting device; otherwise a full device id or a unique prefix of 6+ chars. */
function resolveTarget(host: ApprovalHost, registry: DeviceRegistry, target: string): DeviceEntry {
  const byCode = host.store.findPendingByCode(target)
  const exact = registry.getDevice(byCode ?? target)
  if (exact && !exact.ephemeral) {
    return exact
  }
  const matches =
    target.length >= 6
      ? registry.listDevices().filter((row) => !row.ephemeral && row.deviceId.startsWith(target))
      : []
  if (matches.length === 1) {
    return matches[0]
  }
  throw new Error(
    matches.length > 1
      ? `"${target}" matches more than one device; give more of its id.`
      : `No paired device or waiting code matches "${target}". Run "orca devices list".`
  )
}

function actionResult(row: DeviceEntry): ForkDeviceActionResult {
  return { deviceId: row.deviceId, name: row.name }
}

export function approveForkDevice(target: string): ForkDeviceActionResult {
  const { host, registry } = requireHost()
  const row = resolveTarget(host, registry, target)
  const chain = lineage(registry, row)
  host.store.trust((chain.at(-1) ?? row).deviceId)
  return actionResult(row)
}

async function removeRow(host: ApprovalHost, row: DeviceEntry): Promise<void> {
  const removed =
    row.scope === 'mobile'
      ? await host.server.revokeMobileDevice(row.deviceId)
      : host.server.revokeRuntimeAccess(row.deviceId)
  if (!removed) {
    throw new Error(`Could not remove ${row.name}; it may already be gone.`)
  }
  host.store.forget(row.deviceId)
}

/** Refuses a waiting device: its pairing is removed, so it has to pair again. */
export async function denyForkDevice(target: string): Promise<ForkDeviceActionResult> {
  const { host, registry } = requireHost()
  const row = resolveTarget(host, registry, target)
  const root = lineage(registry, row).at(-1) ?? row
  if (!host.store.pendingFor(root.deviceId)) {
    throw new Error(`${row.name} is not waiting for approval. Use "orca devices revoke" instead.`)
  }
  await removeRow(host, root)
  return actionResult(root)
}

/** Removes one paired device (and anything paired through it), approved or not. */
export async function revokeForkDevice(target: string): Promise<ForkDeviceActionResult> {
  const { host, registry } = requireHost()
  const row = resolveTarget(host, registry, target)
  await removeRow(host, row)
  return actionResult(row)
}
