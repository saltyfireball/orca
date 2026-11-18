// Server memory protection (SLRM-2384, FORK.md): `orca serve service protect`, `protect status`
// and `unprotect`. Local commands: they act on this machine's own systemd user manager.
import { LOCAL_COMMAND_FLAGS } from '../arguments/args'
import type { CommandSpec } from '../discovery/command-spec'

const LINUX_NOTE =
  'Linux only. Works on the unit `orca serve service install` or the dotfiles orca-server installer wrote (orca-serve.service, or orca-serve-<hash>.service for another profile).'

export const FORK_SERVE_PROTECT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['serve', 'service', 'protect'],
    summary: 'Keep the orca serve service alive when agents use up memory (Linux)',
    usage:
      'orca serve service protect [--memory-min <size|off>] [--memory-low <size|off>] [--oom-score-adjust <n|auto|off>] [--child-oom-score-adjust <n|off>] [--system-oom-score-adjust <n>] [--dry-run] [--json]',
    allowedFlags: [
      ...LOCAL_COMMAND_FLAGS,
      'memory-min',
      'memory-low',
      'oom-score-adjust',
      'child-oom-score-adjust',
      'system-oom-score-adjust',
      'dry-run'
    ],
    notes: [
      LINUX_NOTE,
      'Writes a systemd drop-in (50-blackfish-protect.conf) beside the unit, and one for its slice, never the unit itself. MemoryMin (256M) and MemoryLow (1G) keep the server out of memory reclaim and apply at once. OOMScoreAdjust (auto: the lowest the user manager allows) makes the kernel kill other user processes first.',
      "Agents are started by the server's terminal daemon and would inherit its low score, so the daemon raises its own to --child-oom-score-adjust (300) when it starts: agents go first. Scores take effect at the next start of the service and of the terminal daemon; protect does not restart either.",
      'Steps that need root are printed, never run: the same memory protection on user.slice, user-<uid>.slice and user@<uid>.service (protection only reaches the server when every parent slice holds as much), and an OOMScoreAdjust (--system-oom-score-adjust, -500) for tailscaled and sshd so the machine stays reachable. Processes started from a Tailscale SSH session inherit that score.',
      'Run it again to change the values; --dry-run prints the drop-ins and steps without writing anything.'
    ],
    examples: [
      'orca serve service protect',
      'orca serve service protect --memory-low 2G --dry-run',
      'orca serve service protect --oom-score-adjust 100 --child-oom-score-adjust 500'
    ]
  },
  {
    path: ['serve', 'service', 'protect', 'status'],
    summary: 'Show the memory protection of the orca serve service (Linux)',
    usage: 'orca serve service protect status [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      LINUX_NOTE,
      "Shows whether the drop-in is there and loaded, the unit's OOMScoreAdjust, MemoryMin and MemoryLow, the running server's own score, and the values of the parent slices, tailscaled and sshd."
    ],
    examples: ['orca serve service protect status', 'orca serve service protect status --json']
  },
  {
    path: ['serve', 'service', 'unprotect'],
    summary: 'Remove the memory protection of the orca serve service (Linux)',
    usage: 'orca serve service unprotect [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      LINUX_NOTE,
      'Removes only the drop-ins protect wrote and clears the memory values at once; the scores go back at the next start of the service. Root steps you ran stay; undo them with sudo the same way.'
    ],
    examples: ['orca serve service unprotect']
  }
]
