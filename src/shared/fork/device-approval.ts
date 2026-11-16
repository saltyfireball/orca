// SLRM-2271 (FORK.md "Device approval"): a new pairing waits until a device that is already
// approved, or the server's owner, approves it. Shared by the gate, the CLI and the Settings card.
import { z } from 'zod'
import type { ForkGlobalSettings } from './fork-global-settings'

/** The error code a waiting device gets; clients treat it as transient and keep their pairing. */
export const FORK_DEVICE_APPROVAL_PENDING_CODE = 'device_approval_pending'

export type ForkDeviceApprovalStatus = 'approved' | 'waiting' | 'unused-link' | 'not-approved'

export type ForkPairedDevice = {
  deviceId: string
  name: string
  scope: 'mobile' | 'runtime'
  status: ForkDeviceApprovalStatus
  /** Shown on the waiting device; only for status "waiting". */
  code?: string
  pairedAt: number
  lastSeenAt: number
  /** The device this one was paired through (a phone through a desktop, a re-keyed install). */
  via?: string
}

export type ForkDeviceListResult = { enabled: boolean; devices: ForkPairedDevice[] }

export type ForkDeviceActionResult = { deviceId: string; name: string }

/** An approval code (any case, dash optional) or a device id. */
export const ForkDeviceTargetParams = z.object({ target: z.string().trim().min(1).max(200) })
export type ForkDeviceTargetParams = z.infer<typeof ForkDeviceTargetParams>

export function forkDeviceApprovalEnabled(
  settings: Pick<ForkGlobalSettings, 'forkDeviceApproval'> | null | undefined
): boolean {
  return settings?.forkDeviceApproval === true
}

/** Codes compare without case, spaces or dashes. */
export function normalizeForkApprovalCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, '')
}

export const ForkDeviceListParams = z.object({})
