// Command guards (FORK.md, BAD-686): `orca command-guards`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const HOST_NOTE =
  'Each host guards its own agents; add --environment to ask a paired server. The guard reads command text and never runs it. It is a safety net against mistakes, not a sandbox.'

export const FORK_COMMAND_GUARDS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['command-guards', 'list'],
    summary: "List the shell commands Orca's command guard blocked, newest first",
    usage: 'orca command-guards list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Each block shows when, the agent, the rule, the reason, the workspace and the command (cut to 400 characters). The agent was told the reason too, in its chat.',
      'forkCommandGuardAuditLimit (200) is how many are kept.',
      HOST_NOTE
    ],
    examples: ['orca command-guards list', 'orca command-guards list --json']
  },
  {
    path: ['command-guards', 'status'],
    summary: 'Show the guard rules, where a project allows one, and which agents are guarded',
    usage: 'orca command-guards status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      "Only an agent whose hook script reads Orca's answer can be blocked: today Claude Code on macOS and Linux. Every other agent is listed as unguarded, and so is Claude Code on Windows and on SSH or WSL hosts.",
      'Switch the guard off with `orca settings set forkCommandGuards false`; the other forkCommandGuard* settings tune it.',
      HOST_NOTE
    ],
    examples: ['orca command-guards status']
  },
  {
    path: ['command-guards', 'allow'],
    summary: 'Let one rule through for a project, or for every project',
    usage: 'orca command-guards allow <rule> [--project <name|path|id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'rule', 'project'],
    positionalArgs: ['rule'],
    notes: [
      'Rules: delete-outside-workspace, force-push, default-branch-rewrite, remove-worktree, guard-config, unreadable-command.',
      'Without --project the rule is off host-wide (forkCommandGuardDisabledRules). An agent cannot run this command: the guard-config rule blocks it.',
      HOST_NOTE
    ],
    examples: ['orca command-guards allow force-push --project my-repo']
  },
  {
    path: ['command-guards', 'disallow'],
    summary: 'Turn a rule back on for a project, or for every project',
    usage: 'orca command-guards disallow <rule> [--project <name|path|id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'rule', 'project'],
    positionalArgs: ['rule'],
    notes: [HOST_NOTE],
    examples: ['orca command-guards disallow force-push --project my-repo']
  }
]
