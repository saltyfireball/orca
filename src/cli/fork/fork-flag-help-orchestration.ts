// Option text of the fork's orchestration, guard and launch commands (BAD-764).
// Each line is for `orca <command> --help`; fork-flag-help.ts prints it.
import type { ForkFlagHelp, ForkFlagHelpLine } from './fork-flag-help-line'

const QUEUED_LAUNCH_HELP: ForkFlagHelpLine = [
  '<id>',
  'Queued launch, as `orca agent queue list` prints it; also accepted positionally'
]
const PARKED_AGENT_HELP: ForkFlagHelpLine = [
  '<id>',
  'Parked agent, as `orca limits list` prints it; also accepted positionally'
]
const RULE_HELP: ForkFlagHelpLine = [
  '<rule>',
  'Guard rule, as `orca command-guards status` lists them; also accepted positionally'
]
const PROJECT_HELP: ForkFlagHelpLine = [
  '<name|path|id>',
  'Only this project; without it, every project on the host'
]
const HOSTS_HELP: ForkFlagHelpLine = [
  '<all|local>',
  'all: this machine and every paired server (default); local: this machine'
]
const MCP_PROFILE_HELP: ForkFlagHelpLine = [
  '<name>',
  'MCP profile the Claude chat or terminal starts with (`orca mcp-profile list`)'
]
const PROFILE_HELP: ForkFlagHelpLine = [
  '<name>',
  'Agent profile to start from (`orca profiles list`); explicit flags win'
]

const DONE_CONTRACT_HELP: Record<string, ForkFlagHelpLine> = {
  'done-check': [
    "'<command>'",
    "Command run in the worker's workspace when it reports done; repeatable"
  ],
  'require-pr-checks': [
    '',
    "Done needs every required check of the pull request's pushed head green"
  ],
  'done-max-rounds': [
    '<1-10>',
    'Failed done checks sent back before it escalates (default: Settings, 2)'
  ],
  review: ['', "Have the other provider's agent review the head commit before done counts"],
  'review-focus': ['<correctness|security|perf>', 'What the review looks at'],
  'review-agent': ['<claude|codex>', 'Agent that reviews'],
  'review-max-rounds': ['<1-10>', 'Review rounds before it escalates (default: Settings, 2)']
}

export const FORK_ORCHESTRATION_FLAG_HELP: ForkFlagHelp = {
  'orchestration worker-cleanup': {
    bot: ['<name>', 'Only the workers this bot started (its name or id)'],
    'dry-run': ['', 'List what would be removed and what is skipped; remove nothing'],
    'include-remote': ['', 'Also have every paired server clean up its own workspaces']
  },
  'agent queue start': {
    id: QUEUED_LAUNCH_HELP
  },
  'agent queue cancel': {
    id: QUEUED_LAUNCH_HELP
  },
  'launch-defaults': {
    agent: ['<agent>', 'Only this agent, e.g. claude or codex']
  },
  'usage-report': {
    by: ['<grouping>', 'chat (default), coordinator, workspace, day or card'],
    days: ['<n>', 'Only the last n days, today included']
  },
  'limits resume-now': {
    id: PARKED_AGENT_HELP
  },
  'limits cancel': {
    id: PARKED_AGENT_HELP
  },
  'limits usage': {
    refresh: ['', 'Read usage again first (slower)'],
    local: ['', 'Leave out paired servers']
  },
  'guards resume': {
    id: ['<id>', 'Paused agent, as `orca guards list` prints it; also accepted positionally']
  },
  'guards cap': {
    id: [
      '<id>',
      'Chat session id (a listed chat: a unique prefix of 4+ characters); also accepted positionally'
    ],
    usd: ['<usd>', 'Spend cap in USD; 0 goes back to the default; also accepted positionally'],
    run: ['', "Cap the chat's whole Run: its coordinator and every worker together"]
  },
  'guards automation-cap': {
    id: [
      '<automation-id>',
      'Automation id, or a unique prefix of 4+ characters; also accepted positionally'
    ],
    'per-run': [
      '<usd|default>',
      'Spend cap in USD of one run (0 is none, default follows Settings)'
    ],
    day: [
      '<usd|default>',
      'Spend cap in USD of one local day (0 is none, default follows Settings)'
    ],
    week: [
      '<usd|default>',
      'Spend cap in USD of the last 7 days (0 is none, default follows Settings)'
    ]
  },
  'command-guards allow': {
    rule: RULE_HELP,
    project: PROJECT_HELP
  },
  'command-guards disallow': {
    rule: RULE_HELP,
    project: PROJECT_HELP
  },
  'goal set': {
    id: [
      '<id>',
      'Agent, as `orca guards list` prints it, or a unique prefix of 4+ characters; also accepted positionally'
    ],
    'until-cmd': [
      "'<command>'",
      "Command run in the agent's workspace; exit 0 means the goal is met"
    ],
    'until-judge': [
      "'<criteria>'",
      "Criteria the judge command checks the agent's last message against"
    ],
    'max-rounds': ['<n>', 'Continue messages before it stops (default: Settings, 10)'],
    budget: ['<usd>', 'Spend in USD since the goal was set at which it stops (0 is no limit)']
  },
  'goal clear': {
    id: [
      '<id>',
      'Agent, as `orca goal list` prints it, or a unique prefix of 4+ characters; also accepted positionally'
    ]
  },
  'contract show': {
    task: ['<task-id>', 'Task to show; also accepted positionally']
  },
  'retry policy': {
    run: ['<run-id>', 'Run whose policy to show or set'],
    on: ['', 'Restart its workers automatically'],
    off: ['', 'Never restart its workers automatically'],
    max: ['<0-10>', 'Restarts per Task at most'],
    backoff: ['<seconds>', 'Wait before the first restart; doubles for each next one'],
    clear: ['', "Drop the Run's own policy"]
  },
  'retry show': {
    task: ['<task-id>', 'Only the retries of this Task'],
    run: ['<run-id>', 'Only the retries of this Run']
  },
  'pause-all': {
    hosts: HOSTS_HELP,
    note: ['<text>', 'Why, shown with the pause']
  },
  'resume-all': {
    hosts: HOSTS_HELP
  },
  'pause-status': {
    hosts: HOSTS_HELP
  },
  'agent launch': {
    'mcp-profile': MCP_PROFILE_HELP,
    profile: PROFILE_HELP
  },
  'automations create': {
    profile: PROFILE_HELP
  },
  'orchestration worker-start': {
    'mcp-profile': MCP_PROFILE_HELP,
    profile: PROFILE_HELP,
    card: ['<KEY>', 'Linear card to link a new workspace to'],
    ...DONE_CONTRACT_HELP
  },
  'orchestration task-create': DONE_CONTRACT_HELP,
  'orchestration send': {
    'as-service': ['', 'Send as a background service with no terminal or chat of its own']
  }
}
