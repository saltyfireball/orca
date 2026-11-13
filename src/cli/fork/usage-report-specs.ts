// SLRM-2104 (FORK.md "Usage and cost report"): `orca usage-report`.
import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const FORK_USAGE_REPORT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['usage-report'],
    summary: 'Show tokens and estimated cost of native Claude chats',
    usage: 'orca usage-report [--by chat|coordinator|workspace|day|card] [--days <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'by', 'days'],
    notes: [
      'Rolled up per chat (the default), per coordinator (a chat plus the workers it dispatched), per workspace, per day, or per card. A chat includes its sub-agents.',
      'Cards come from the card pattern in Settings > Advanced > Usage report, a regular expression over the workspace name; group 1 (or the whole match) is the card. Empty by default.',
      'Costs are estimates from the price table in the same settings. Chats signed in with a subscription show tokens only: they are not billed per token.',
      '--days N keeps the last N days, today included. Without it, everything the ledger keeps.'
    ],
    examples: [
      'orca usage-report',
      'orca usage-report --by day --days 7',
      'orca usage-report --by coordinator --json'
    ]
  }
]
