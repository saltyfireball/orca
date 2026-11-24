// Option lines of the fork's commands and of the flags it adds to stock commands (FORK.md, BAD-764).
// A flag without its own line here prints the stock text of any flag of the same name, or nothing.
import { forkSettingsFlagHelp } from './settings-specs'
import { FORK_CHAT_FLAG_HELP } from './fork-flag-help-chats'
import type { ForkFlagHelp } from './fork-flag-help-line'
import { FORK_ORCHESTRATION_FLAG_HELP } from './fork-flag-help-orchestration'
import { FORK_WORKSPACE_FLAG_HELP } from './fork-flag-help-workspaces'

export const FORK_FLAG_HELP: ForkFlagHelp = {
  ...FORK_CHAT_FLAG_HELP,
  ...FORK_ORCHESTRATION_FLAG_HELP,
  ...FORK_WORKSPACE_FLAG_HELP
}

/** Where the option text starts, as in the stock lines. */
const TEXT_COLUMN = 23

/** Hook in help.ts: the option line of a fork flag, else undefined. */
export function forkFlagHelp(command: string, flag: string): string | undefined {
  const settings = forkSettingsFlagHelp(command, flag)
  const commandHelp = Object.hasOwn(FORK_FLAG_HELP, command) ? FORK_FLAG_HELP[command] : {}
  if (settings !== undefined || !Object.hasOwn(commandHelp, flag)) {
    return settings
  }
  const [value, text] = commandHelp[flag]
  const head = `--${flag}${value ? ` ${value}` : ''}`
  return `${head} `.padEnd(TEXT_COLUMN) + text
}
