// BAD-640 (FORK.md "Bot connect from the CLI"): `orca bot connect`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_BOT_CONNECT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['bot', 'connect'],
    summary:
      'Link the Linear workspaces and GitHub account already connected on this computer to one bot or all of them',
    usage: 'orca bot connect (--bot <name> | --all) [--linear] [--github] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'bot', 'all', 'linear', 'github'],
    notes: [
      "The same link as Turn on in a bot's Connectors setup, once Linear or GitHub is connected: saved on the bot (bots.update). Without --linear or --github it links both.",
      'Linear: every workspace the owner is linked in where Orca is installed. GitHub: the linked account, once the Orca app is installed somewhere. Bots already linked are skipped.',
      'It never starts a sign-in. A connector not yet connected on that computer is connected once from any bot in Orca; after that this links the rest.',
      "--all covers the bots of the computer asked only. With --environment it links the bots of that paired server, using that server's own connected accounts."
    ],
    examples: [
      'orca bot connect --all',
      'orca bot connect --bot Review --linear',
      'orca bot connect --all --github --environment my-server'
    ]
  }
]
