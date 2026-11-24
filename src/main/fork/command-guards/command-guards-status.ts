// Command guards (FORK.md, BAD-686): `fork.commandGuards.status` of this host. Apart from the guard
// itself (command-guards-live.ts), which the CLI's program reaches through the hook script and which
// so may not import the chat host. Keep electron out of this file.
import {
  COMMAND_GUARD_RULES,
  COMMAND_GUARD_RULE_TEXT,
  commandGuardCoverage
} from '../../../shared/fork/command-guards'
import type { ForkCommandGuardsStatusResult } from '../../../shared/fork/command-guards-wire'
import {
  forkCommandGuardChatList,
  forkCommandGuardChatSurfaces
} from './command-guards-chat-registry'
import { liveCommandGuardChats } from './command-guards-live-chats'
import {
  commandGuardConfig,
  commandGuardRepoName,
  commandGuardRepos,
  forkCommandGuardsRunning
} from './command-guards-live'
import {
  terminalGaps,
  withTerminalGaps,
  type ForkCommandGuardLiveAgent
} from './command-guards-terminal-gaps'

export type { ForkCommandGuardLiveAgent }

/** `live` is this host's agent status rows (the hook server's snapshot). */
export function forkCommandGuardStatus(
  live: readonly ForkCommandGuardLiveAgent[],
  platform: NodeJS.Platform = process.platform
): ForkCommandGuardsStatusResult {
  const settled = commandGuardConfig()
  const gaps = terminalGaps(live)
  const running = forkCommandGuardsRunning()
  const chats = liveCommandGuardChats()
  const names = new Map(commandGuardRepos().map((repo) => [repo.id, commandGuardRepoName(repo)]))
  return {
    enabled: settled.enabled,
    rules: COMMAND_GUARD_RULES.map((rule) => ({
      rule,
      summary: COMMAND_GUARD_RULE_TEXT[rule],
      offEverywhere: settled.disabled.has(rule),
      allowedIn: Object.entries(settled.projectAllowed)
        .filter(([, rules]) => rules.has(rule))
        .map(([id]) => names.get(id) ?? id)
    })),
    agents: commandGuardCoverage(),
    surfaces: withTerminalGaps(forkCommandGuardChatSurfaces(running, chats), gaps.length, platform),
    unguardedWorkspaces: gaps,
    chats: forkCommandGuardChatList(running, chats)
  }
}
