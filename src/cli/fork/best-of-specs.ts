// Best of N (FORK.md, SLRM-2393): `orca best-of`. `list`, `show` and `pick` come first, so their
// words are never read as the bare command's count.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const STATE_NOTE =
  "Runs are kept by this machine's Orca, also for attempts on paired servers; run these without --environment."

export const FORK_BEST_OF_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['best-of', 'list'],
    // An alias makes the positional pass match `best-of list` before the bare command's count.
    aliases: [['best-of', 'ls']],
    summary: 'List best-of runs, newest first',
    usage: 'orca best-of list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [STATE_NOTE],
    examples: ['orca best-of list']
  },
  {
    path: ['best-of', 'show'],
    summary: "Compare a best-of run's attempts: diff, tests and checks, cost and report",
    usage: 'orca best-of show <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    notes: [
      'An id is as `orca best-of list` prints it; a unique prefix of 4+ characters is enough.',
      'Tests and checks are what each attempt wrote on its Tests: and Checks: report lines. Cost counts native Claude chats on this machine only.',
      STATE_NOTE
    ],
    examples: ['orca best-of show 3f2a9c']
  },
  {
    path: ['best-of', 'pick'],
    destructive: true,
    summary: 'Keep one attempt and archive (or remove) the worktrees of the others',
    usage: 'orca best-of pick <id> --attempt <n> [--losers archive|remove|keep] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'attempt', 'losers'],
    positionalArgs: ['id'],
    notes: [
      'Without --losers, Settings > Blackfish > Best of N decides (archive by default). Archive deletes the checkout and keeps its branch and workspace row; remove deletes the checkout and keeps the branch. Neither is forced: a worktree with uncommitted changes stays, and the pick says so.',
      'A run is picked once.'
    ],
    examples: ['orca best-of pick 3f2a9c --attempt 2']
  },
  {
    path: ['best-of'],
    summary: 'Send one task to 2 to 4 agents, each in its own new worktree, to compare and pick',
    usage:
      'orca best-of <n> (--prompt <text> | --prompt-file <path|->) [--agents <agent[:model[:effort]],...>] [--on <auto|here|server>,...] [--repo <selector>] [--base-branch <ref>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'count',
      'prompt',
      'prompt-file',
      'agents',
      'on',
      'repo',
      'base-branch'
    ],
    positionalArgs: ['count'],
    notes: [
      'Each attempt is a supervised orchestration worker in a new top-level worktree, started from the terminal or chat you run this in; all attempts share one Run.',
      '--agents and --on are lists cycled over the attempts: --agents claude,codex with 3 attempts runs claude, codex, claude. Without them, Settings > Blackfish > Best of N gives the defaults (claude on auto).',
      'auto asks auto placement for a machine per attempt and needs --repo; here is this machine; any other value is a paired server, as worker-start --on takes it.',
      'Each attempt is asked to commit its work and to end its report with Tests: and Checks: lines, which the compare view reads.',
      'Compare and pick in the app (command palette: Best of N) or with `orca best-of show` and `orca best-of pick`.'
    ],
    examples: [
      'orca best-of 3 --prompt "Fix the flaky login test" --repo my-app',
      'orca best-of 2 --prompt-file task.md --agents claude:opus,codex --on here'
    ]
  }
]
