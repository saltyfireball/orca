// Keep main current (SLRM-2384, FORK.md): `orca main-sync` and `orca main-sync run`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const HOST_NOTE =
  "Each host keeps its own projects current; add --environment to ask a paired server, where new worktrees start from that server's checkout."

export const FORK_MAIN_SYNC_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['main-sync'],
    summary: "Show what keep main current last did to each project's default branch",
    usage: 'orca main-sync [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Off by default: `orca settings set forkMainSync true` turns it on for this host. Every `forkMainSyncMinutes` (15) it fetches the default branch of each local git project (`forkMainSyncProjects`, unset is all) and fast-forwards it.',
      'A branch is never moved when it has diverged from the remote or has commits the remote lacks, when its checkout has local changes or a merge or rebase under way, when a linked worktree has it checked out, or, unless `forkMainSyncSkipInUse` is false, while its checkout has live terminals or a working agent. Fetches use the credentials git already has.',
      HOST_NOTE
    ],
    examples: ['orca main-sync', 'orca main-sync --json', 'orca main-sync --environment build-box']
  },
  {
    path: ['main-sync', 'run'],
    summary: "Fetch and fast-forward the projects' default branches now",
    usage: 'orca main-sync run [--repo <name|id|path>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo'],
    notes: [
      'Runs one pass now, even while the timer is off, over --repo or the projects `forkMainSyncProjects` names, with the same safety rules, and prints what it did to each.',
      HOST_NOTE
    ],
    examples: ['orca main-sync run', 'orca main-sync run --repo orca']
  }
]
