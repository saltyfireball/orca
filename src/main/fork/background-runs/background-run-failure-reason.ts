// A look or tidy-up whose turn failed records why (BAD-838), as an automation run does (upstream
// #47491): "didn't finish" alone hid a signed-out account behind every failed look.
import { tuiAgentDisplayName } from '../../../shared/agent-launch/catalog/tui-agent-display-names'
import { structuredAgentSessionRefusalLine } from '../../../shared/agent-session/requests/structured-agent-session-turn-failure'
import type { BotTurnEnd } from '../../bots/bot-run-turn-watch'

/** `failure`, then the turn's own failure line or the agent's refusal of its start, when known. */
export function forkBackgroundRunFailure(
  failure: string,
  ended: BotTurnEnd,
  agent: string
): string {
  if ('unavailable' in ended) {
    return failure
  }
  const why =
    ended.error ??
    structuredAgentSessionRefusalLine(ended.refusal, tuiAgentDisplayName(agent) ?? undefined)
  return why ? `${failure} ${why}` : failure
}
