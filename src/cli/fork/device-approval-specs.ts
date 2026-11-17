// SLRM-2271 (FORK.md "Device approval"): `orca devices`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const TARGET_NOTE =
  'A target is the approval code the waiting device shows, or a device id from `orca devices list` (a unique prefix of 6 or more characters is enough).'
const HOST_NOTE =
  'Runs against this machine; --environment <name> acts on a paired server instead, from any approved desktop.'

export const FORK_DEVICE_APPROVAL_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['devices', 'list'],
    summary: 'List paired devices and whether each is approved or waiting',
    usage: 'orca devices list [--environment <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Device approval is off by default. Turn it on with `orca settings set forkDeviceApproval true` (on the server, or with --environment); a device paired after that waits until it is approved.',
      'Devices that were already paired when approval was turned on stay approved. A phone or re-keyed install paired through an approved device is approved with it.',
      HOST_NOTE
    ],
    examples: ['orca devices list', 'orca devices list --environment build-box']
  },
  {
    path: ['devices', 'approve'],
    summary: 'Approve a waiting device so it can use this host',
    usage: 'orca devices approve <target> [--environment <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'target'],
    positionalArgs: ['target'],
    notes: [
      'Check that the code matches the one the new device shows before approving it.',
      TARGET_NOTE,
      HOST_NOTE
    ],
    examples: ['orca devices approve K7MQ-4PXA']
  },
  {
    path: ['devices', 'deny'],
    summary: 'Refuse a waiting device and remove its pairing',
    usage: 'orca devices deny <target> [--environment <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'target'],
    positionalArgs: ['target'],
    notes: [
      'The pairing link it used stops working; it has to pair again.',
      TARGET_NOTE,
      HOST_NOTE
    ],
    examples: ['orca devices deny K7MQ-4PXA']
  },
  {
    path: ['devices', 'revoke'],
    summary: 'Remove a paired device, approved or not, and anything paired through it',
    usage: 'orca devices revoke <target> [--environment <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'target'],
    positionalArgs: ['target'],
    notes: ['Its open connections close at once.', TARGET_NOTE, HOST_NOTE],
    examples: ['orca devices revoke 3f2a9c']
  }
]
