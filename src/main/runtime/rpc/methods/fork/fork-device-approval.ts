// SLRM-2271 (FORK.md "Device approval"): `orca devices` and the Settings card. host-admin, so the
// owner and approved paired desktops can act; a waiting device is refused before it gets here.
import { defineMethod } from '../../core'
import {
  ForkDeviceListParams,
  ForkDeviceTargetParams
} from '../../../../../shared/fork/device-approval'
import {
  approveForkDevice,
  denyForkDevice,
  listForkPairedDevices,
  revokeForkDevice
} from '../../../../fork/device-approval/device-approval-service'

export const FORK_DEVICE_APPROVAL_METHODS = [
  defineMethod({
    name: 'fork.devices.list',
    permission: 'host-admin',
    params: ForkDeviceListParams,
    handler: async () => listForkPairedDevices()
  }),
  defineMethod({
    name: 'fork.devices.approve',
    permission: 'host-admin',
    params: ForkDeviceTargetParams,
    handler: async (params) => approveForkDevice(params.target)
  }),
  defineMethod({
    name: 'fork.devices.deny',
    permission: 'host-admin',
    params: ForkDeviceTargetParams,
    handler: async (params) => denyForkDevice(params.target)
  }),
  defineMethod({
    name: 'fork.devices.revoke',
    permission: 'host-admin',
    params: ForkDeviceTargetParams,
    handler: async (params) => revokeForkDevice(params.target)
  })
] as const
