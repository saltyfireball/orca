// Card routing (BAD-694, FORK.md): `orca card route`, and --card on `orchestration worker-start`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'
import { FORK_CARD_FLAG } from './card-route-flag'
import { FORK_BOT_ITEM_ANSWER_COMMAND_SPECS } from './bot-item-answer-specs'

export const FORK_CARD_ROUTE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['card', 'route'],
    summary: 'Hand a Linear card to the bot that takes it, by its bot: label or the project map',
    usage: 'orca card route <KEY> [--hand-off] [--bot <name>] [--label-only] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'key', 'hand-off', 'bot', 'label-only'],
    positionalArgs: ['key'],
    notes: [
      'A card someone already has is not routed again: an earlier hand-off\'s card comment, a bot item linking the card or naming its key, or the owner\'s answer to an earlier "Which bot takes KEY?" names its bot, and it prints that instead (no new chat, no new question). --bot <name> still moves it to a different bot.',
      'A `bot:<name>` label on the card wins; then the card\'s project, then its team, in forkCardRoutes (Settings > Blackfish, a map like {"Docs":"Writer"}). Then the one bot whose repos the card names (by repo name, else by a file path found in that repo; a bot claims the projects it loads skills from and the repos its SOUL.md names). For a card with no project, forkCardNoProjectBot. Then, so nothing waits on the owner, forkCardDefaultBot, then the bot that ran the route, then the quick task router. forkCardAskOwner turns that off and asks the owner instead.',
      'Without --hand-off it only says which bot. --hand-off starts that bot in a new chat titled "KEY: summary" (on its paired server for a bot there), acting for you, and tells it to finish the card end to end (PR, merge, deploy, move the card) and report to the bot that handed it off. It comments "<Bot> bot on it, chat <id> ("KEY: summary"), machine <m>" on the card, naming the receiving bot\'s own chat, and prints that chat id and machine.',
      "Only when no default exists either (or forkCardAskOwner is on), --hand-off from a bot's chat posts a Needs you item asking which of 2 or 3 bots takes it; from anywhere else the router bot posts it from its own routing chat. Run it again with --bot <their choice>.",
      '--label-only does nothing unless a bot: label decides, for automations on new cards.'
    ],
    examples: ['orca card route BAD-12', 'orca card route BAD-12 --hand-off --json']
  },
  // BAD-737: rides in this list so the spec index stays as it is.
  ...FORK_BOT_ITEM_ANSWER_COMMAND_SPECS
]

const WORKER_START = 'orchestration worker-start'
const CARD_NOTE =
  '--card <KEY> links a new workspace (new-child or new-top-level) to that Linear card, so its agent lists under the card; it changes nothing for an existing one.'

/** Adds --card to worker-start; one hook on the spec list. */
export function withForkCardFlag(specs: CommandSpec[]): CommandSpec[] {
  return specs.map((spec) =>
    spec.path.join(' ') === WORKER_START
      ? {
          ...spec,
          usage: spec.usage.replace(/ \[--json\]$/, ' [--card <KEY>] [--json]'),
          allowedFlags: [...spec.allowedFlags, FORK_CARD_FLAG],
          notes: [...(spec.notes ?? []), CARD_NOTE]
        }
      : spec
  )
}
