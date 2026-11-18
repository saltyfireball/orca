// SLRM-2388 (FORK.md "Digest"): `orca digest`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_DIGEST_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['digest'],
    summary:
      'Summarize what finished, failed, merged and cost, and what waits on you, on this host and every paired server',
    usage: 'orca digest [--since <when>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'since'],
    notes: [
      '--since takes a duration back from now (90m, 12h, 2d, 1w) or a date and time (2026-11-18 or 2026-11-18T07:00). Without it, the window starts at the last daily digest, else a day ago. At most 90 days.',
      'Finished and failed are orchestration tasks. Pull requests are yours, read with the GitHub CLI (gh) in each project; merged ones in the window and every open one. Cost is the usage ledger estimate of the days the window touches, on the desktop only. Waiting on you is the Decision inbox, which lists chats only while idle recovery is on.',
      'The daily digest (Settings > Blackfish > Usage and accounts > Digest, `forkDigest`) sends the same to the notification targets; this command sends nothing.'
    ],
    examples: ['orca digest', 'orca digest --since 12h', 'orca digest --since 2026-11-17 --json']
  }
]
