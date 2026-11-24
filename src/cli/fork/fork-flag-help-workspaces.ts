// Option text of the fork's workspace, server and host commands (BAD-764).
// Each line is for `orca <command> --help`; fork-flag-help.ts prints it.
import type { ForkFlagHelp, ForkFlagHelpLine } from './fork-flag-help-line'

const REPO_HELP: ForkFlagHelpLine = ['<name|id|path>', 'Only this project']
const ID_HELP: ForkFlagHelpLine = [
  '<id>',
  'Checkpoint, as `orca checkpoint list` prints it; also accepted positionally'
]
const FORCE_HELP: ForkFlagHelpLine = [
  '',
  'Restore even while another agent works in the same directory'
]
const TARGET_HELP: ForkFlagHelpLine = [
  '<target>',
  'Approval code or device id; also accepted positionally'
]
const TARGET_2_HELP: ForkFlagHelpLine = [
  '<webhook>',
  'Webhook id, unique id prefix or name; also accepted positionally'
]
const NOW_HELP: ForkFlagHelpLine = ['', 'Restart without waiting for running turns']
const WAIT_HELP: ForkFlagHelpLine = [
  '<minutes>',
  "How long to wait for running turns (default: the server's setting)"
]
const ID_2_HELP: ForkFlagHelpLine = [
  '<id>',
  'Run, as `orca best-of list` prints it, or a unique prefix of 4+ characters; also accepted positionally'
]
const PR_HELP: ForkFlagHelpLine = [
  '<pr>',
  'Pull request number, #number or URL; also accepted positionally'
]
const REPO_2_HELP: ForkFlagHelpLine = ['<id|name>', 'Project of the pull request']

export const FORK_WORKSPACE_FLAG_HELP: ForkFlagHelp = {
  'lost-work': {
    repo: ['<id|name>', 'Only this project']
  },
  placement: {
    repo: ['<selector>', 'Skip machines where this repo selector does not resolve'],
    project: ['<id-or-name>', 'Skip machines with no ready setup of this project'],
    'setup-missing': ['', 'With --project: count paired servers that could clone it']
  },
  'worktree create': {
    'mcp-profile': [
      '<name>',
      'MCP profile the Claude chat or terminal starts with (`orca mcp-profile list`)'
    ],
    profile: ['<name>', 'Agent profile to start from (`orca profiles list`); explicit flags win'],
    'setup-missing': ['', 'With --host: let a paired server that lacks the project clone it first']
  },
  'worktree move': {
    to: ['<host>', 'local, runtime:<environment-id> or a paired server name'],
    worktree: ['<selector>', 'Workspace to move (default: the one of the current folder)'],
    'stop-turns': ['', 'Stop running turns instead of refusing'],
    'dry-run': ['', 'Print what the move would do and change nothing']
  },
  'worktree snapshots': {
    repo: REPO_HELP,
    prune: ['', 'Delete the expired snapshots now']
  },
  'worktree restore': {
    id: ['<id>', 'Snapshot, as `orca worktree snapshots` prints it; also accepted positionally'],
    repo: ['<name|id|path>', 'Project of the snapshot'],
    path: ['<folder>', 'Folder to restore to (default: its old path)']
  },
  'workspace reclaim': {
    idle: ['<3d|12h|90m>', 'Only workspaces idle at least this long (default 3 days)'],
    repo: ['<id|name>', 'Only workspaces of this project'],
    worktree: ['<id|path>', 'Only this workspace'],
    'dry-run': ['', 'List each path and its size; delete nothing']
  },
  'checkpoint diff': {
    id: ID_HELP,
    now: ['', 'Compare the checkpoint with the files as they are on disk'],
    patch: ['', 'Also print the patch text']
  },
  'checkpoint restore': {
    id: ID_HELP,
    force: FORCE_HELP
  },
  'checkpoint undo': {
    force: FORCE_HELP
  },
  'devices approve': {
    target: TARGET_HELP
  },
  'devices deny': {
    target: TARGET_HELP
  },
  'devices revoke': {
    target: TARGET_HELP
  },
  'webhooks list': {
    bot: ['<name>', "List this bot's webhooks instead"]
  },
  'webhooks add': {
    name: ['<name>', 'Name for the webhook'],
    automation: ['<id>', 'Automation each delivery starts'],
    event: ['<a,b>', 'Only deliveries with one of these event names'],
    when: ['<path=value,...>', 'Only JSON payloads where each dotted path holds the value']
  },
  'webhooks rotate': {
    target: TARGET_2_HELP
  },
  'webhooks remove': {
    target: TARGET_2_HELP
  },
  snooze: {
    target: [
      '<target>',
      'Workspace selector or chat:<id> (default: the workspace of the current folder); also accepted positionally'
    ],
    until: [
      '<when>',
      'merge, idle:<days>d, a duration, evening, tomorrow, monday, a time or a date and time'
    ],
    host: ['<runtime:id>', 'Paired server the workspace is on']
  },
  'snooze wake': {
    id: [
      '<id>',
      'Snooze, as `orca snooze list` prints it, or a unique prefix of 4+ characters; also accepted positionally'
    ]
  },
  'servers update': {
    server: ['<name>', 'Paired server to update; several are accepted positionally'],
    all: ['', 'Update every paired server'],
    version: ['<x.y.z>', "Version to install (default: this desktop's)"],
    now: NOW_HELP,
    wait: WAIT_HELP,
    'allow-downgrade': ['', 'Let a server go to an older version']
  },
  'servers rollback': {
    server: ['<name>', 'Paired server to roll back; also accepted positionally'],
    now: NOW_HELP,
    wait: WAIT_HELP
  },
  'main-sync run': {
    repo: REPO_HELP
  },
  'serve service protect': {
    'memory-min': ['<size|off>', 'MemoryMin of the service (default 256M)'],
    'memory-low': ['<size|off>', 'MemoryLow of the service (default 1G)'],
    'oom-score-adjust': [
      '<n|auto|off>',
      'OOMScoreAdjust of the service (default auto, the lowest allowed)'
    ],
    'child-oom-score-adjust': ['<n|off>', 'Score of the agents it starts (default 300)'],
    'system-oom-score-adjust': ['<n>', 'Score printed for tailscaled and sshd (default -500)'],
    'dry-run': ['', 'Print the drop-ins and steps; write nothing']
  },
  clashes: {
    project: ['<name|id>', 'Only this project'],
    refresh: ['', 'Check again instead of using the last check']
  },
  'best-of show': {
    id: ID_2_HELP
  },
  'best-of pick': {
    id: ID_2_HELP,
    attempt: ['<n>', 'Number of the attempt to keep'],
    losers: [
      '<archive|remove|keep>',
      'What happens to the other worktrees (default: Settings, archive)'
    ]
  },
  'best-of': {
    count: ['<2-4>', 'How many attempts; also accepted positionally'],
    prompt: ['<text>', 'The task every attempt gets'],
    'prompt-file': ['<path|->', 'Read the task from a file or stdin'],
    agents: ['<agent[:model[:effort]],...>', 'Agents, cycled over the attempts'],
    on: ['<auto|here|server>,...', 'Machines, cycled over the attempts'],
    repo: ['<selector>', 'Repo the attempts work in; --on auto needs it'],
    'base-branch': ['<ref>', 'Branch or ref the worktrees start from']
  },
  'review-guide write': {
    pr: PR_HELP,
    repo: REPO_2_HELP,
    wait: ['', 'Wait and print the guide when it is done']
  },
  'review-guide cancel': {
    pr: PR_HELP,
    repo: REPO_2_HELP
  },
  'review-guide': {
    pr: PR_HELP,
    repo: REPO_2_HELP
  }
}
