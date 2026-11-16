// SLRM-2271 (FORK.md "Device approval"): `orca devices`, through the fork.devices.* RPCs.
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import type {
  ForkDeviceActionResult,
  ForkDeviceListResult,
  ForkPairedDevice
} from '../../shared/fork/device-approval'

const STATUS_LABEL: Record<ForkPairedDevice['status'], string> = {
  approved: 'approved',
  waiting: 'waiting',
  'unused-link': 'link not used',
  'not-approved': 'not approved'
}

function when(ms: number): string {
  return ms > 0 ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '-'
}

export function formatDeviceList(result: ForkDeviceListResult): string {
  const lines = [`Device approval is ${result.enabled ? 'on' : 'off'} on this host.`]
  if (result.devices.length === 0) {
    lines.push('No paired devices.')
    return lines.join('\n')
  }
  lines.push(
    [
      'ID'.padEnd(12),
      'NAME'.padEnd(28),
      'KIND'.padEnd(7),
      'STATUS'.padEnd(14),
      'CODE'.padEnd(9),
      'LAST SEEN'
    ].join('  ')
  )
  for (const device of result.devices) {
    const name = device.name.length > 28 ? `${device.name.slice(0, 25)}...` : device.name
    lines.push(
      [
        device.deviceId.slice(0, 12).padEnd(12),
        name.padEnd(28),
        (device.scope === 'mobile' ? 'phone' : 'desktop').padEnd(7),
        STATUS_LABEL[device.status].padEnd(14),
        (device.code ?? '').padEnd(9),
        when(device.lastSeenAt)
      ].join('  ')
    )
  }
  return lines.join('\n')
}

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host has no device approval. It needs a Blackfish build with SLRM-2271.'
    )
  }
  throw error
}

async function act(ctx: HandlerContext, method: string, verb: string): Promise<void> {
  const target = getRequiredStringFlag(ctx.flags, 'target')
  const result = await ctx.client
    .call<ForkDeviceActionResult>(method, { target })
    .catch(incompatible)
  printResult(result, ctx.json, (r) => `${r.name} (${r.deviceId.slice(0, 12)}): ${verb}`)
}

export const FORK_DEVICE_APPROVAL_HANDLERS: Record<string, CommandHandler> = {
  'devices list': async (ctx) => {
    const result = await ctx.client
      .call<ForkDeviceListResult>('fork.devices.list', {})
      .catch(incompatible)
    printResult(result, ctx.json, formatDeviceList)
  },
  'devices approve': (ctx) => act(ctx, 'fork.devices.approve', 'approved'),
  'devices deny': (ctx) => act(ctx, 'fork.devices.deny', 'denied and removed'),
  'devices revoke': (ctx) => act(ctx, 'fork.devices.revoke', 'removed')
}
