// Agent guards (FORK.md, SLRM-2385): `orca guards`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const HOST_NOTE =
  'Each host guards its own chats and terminal agents; add --environment to ask a paired server.'
const ID_NOTE =
  'An id is as `orca guards list` prints it (a chat session id or a terminal pane key); a unique prefix of 4+ characters is enough.'

export const FORK_GUARDS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['guards', 'list'],
    summary:
      'List agents a guard warned or paused, agents with a spend cap, and Run and automation caps',
    usage: 'orca guards list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'The failure-loop guard warns an agent that repeats the same failing tool call, then pauses it if the call fails again.',
      'The spend cap pauses a chat at the end of the turn that took its estimated spend past its cap, and stops a terminal agent (Claude Code or Codex) when its next tool call finishes past it.',
      'Each capped agent lists every cap that covers it with its spend: its own (chat), its Run (a coordinator and its workers together) and its automation (run, day, week). Runs and automations with a cap are listed below the table.',
      HOST_NOTE
    ],
    examples: ['orca guards list', 'orca guards list --json']
  },
  {
    path: ['guards', 'resume'],
    summary: 'Lift a guard pause; a chat spends against its cap again from now',
    usage: 'orca guards resume <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    notes: [
      ID_NOTE,
      'Messages the interrupt held follow the Stop button: they go after your next message.',
      HOST_NOTE
    ],
    examples: ['orca guards resume 3f2a9c']
  },
  {
    path: ['guards', 'cap'],
    summary:
      'Set one chat its own spend cap in USD, or with --run its whole Run (0 goes back to the default)',
    usage: 'orca guards cap <id> <usd> [--run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'usd', 'run'],
    positionalArgs: ['id', 'usd'],
    notes: [
      'Per dispatch: a coordinator caps a worker with the session id worker-start printed.',
      "With --run the cap covers the chat's Run: its coordinator and every worker it dispatched, added together. At the cap every agent in the Run is paused (one in a turn at the end of it).",
      'Spend is estimated from the usage ledger at per-token prices (Settings > Blackfish > Usage report), counted from when the cap is set. Claude and Codex chats and terminals (including terminal workers of a Run) are counted. Not counted: OpenCode, ACP, Pi and other agents with no usage record, terminals on SSH or WSL hosts, and agents on paired servers; a Run lists how many of its agents are not counted.',
      HOST_NOTE
    ],
    examples: [
      'orca guards cap 3f2a9c 5',
      'orca guards cap 3f2a9c 20 --run',
      'orca guards cap 3f2a9c 0'
    ]
  },
  {
    path: ['guards', 'automation-cap'],
    summary: 'Set an automation its own spend caps in USD per run, per day and per 7 days',
    usage:
      'orca guards automation-cap <automation id> [--per-run <usd|default>] [--day <usd|default>] [--week <usd|default>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'per-run', 'day', 'week'],
    positionalArgs: ['id'],
    notes: [
      'A run past --per-run has its agent paused at the end of its turn. Past --day (the local day) or --week (the last 7 days) further scheduled and event runs are skipped, with the reason in run history, and a run in progress is paused; Run now still goes.',
      'A number sets that cap (0 means none for this automation); default follows the Blackfish setting again. A flag you leave out is unchanged.',
      "Spend is what the usage ledger holds for the run's agent, else the cost the run recorded when it finished.",
      HOST_NOTE
    ],
    examples: [
      'orca guards automation-cap 7c1d --day 10',
      'orca guards automation-cap 7c1d --per-run 2 --week default'
    ]
  }
]
