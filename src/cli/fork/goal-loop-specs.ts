// Goal loop (BAD-682, FORK.md): `orca goal set | list | clear`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const HOST_NOTE =
  'Each host runs the loop for its own agents; add --environment to set a goal on an agent of a paired server.'
const ID_NOTE =
  'An id is a chat session id or a terminal pane key as `orca guards list` and the agent rows print them; a unique prefix of 4+ characters is enough.'

export const FORK_GOAL_LOOP_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['goal', 'set'],
    summary:
      'Keep an agent going until a check command or a judge says its goal is met, under a round limit, a budget and a stall limit',
    usage:
      "orca goal set <id> (--until-cmd '<command>' | --until-judge '<criteria>') [--max-rounds <n>] [--budget <usd>] [--json]",
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'until-cmd', 'until-judge', 'max-rounds', 'budget'],
    positionalArgs: ['id'],
    notes: [
      "Works for any agent: a native chat of any provider or a terminal agent. When the agent's turn ends and it has rested a few seconds, Orca runs the --until-cmd command in the agent's workspace (exit 0 means met), or asks the judge command from Settings > Blackfish (forkGoalJudgeCommand) whether the agent's last message meets the criteria. If not met it sends the agent a continue message with the failure as untrusted data.",
      'The loop stops when the goal is met, after --max-rounds continue messages (default: Settings, 10), when the spend since the goal was set reaches --budget (USD, 0 or none is no limit; counted from the usage ledger: Claude and Codex chats and terminals, with or without a spend cap set; other agents read $0 and the budget never stops them, which `orca goal list` says), or when the same failure comes back twice in a row. A stop that is not a success is told to the agent in its chat and listed in the Decision inbox.',
      'The command and the criteria come only from this request, never from what an agent wrote. With no goal set nothing changes.',
      ID_NOTE,
      HOST_NOTE
    ],
    examples: [
      "orca goal set 3f2a9c --until-cmd 'test -f done.txt'",
      "orca goal set 3f2a9c --until-cmd 'pnpm test' --max-rounds 5 --budget 10",
      "orca goal set 3f2a9c --until-judge 'The README documents every CLI flag'"
    ]
  },
  {
    path: ['goal', 'list'],
    summary:
      'List the goals of this host with their rounds, spend and why the stopped ones stopped',
    usage: 'orca goal list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [HOST_NOTE],
    examples: ['orca goal list']
  },
  {
    path: ['goal', 'clear'],
    summary: "Remove an agent's goal, or a stopped goal's row",
    usage: 'orca goal clear <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    notes: [ID_NOTE, HOST_NOTE],
    examples: ['orca goal clear 3f2a9c']
  }
]
