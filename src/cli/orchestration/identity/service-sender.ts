// Fork (BAD-742): `orchestration send --as-service` mails a bot from a background service (an MCP
// bridge, a scheduler) that runs outside every Orca terminal and chat, so it has no handle to send from.
import { parseBotAddress } from '../../../shared/bot-roster'
import { ORCA_SCRUB_SAFE_PANE_ENV } from '../../../shared/agent-hook-listener/transport/agent-hook-scrub-safe-env'
import { getOptionalStringFlag } from '../../arguments/flags'
import { RuntimeClientError } from '../../runtime/connection/types'
import { hasStructuredSessionMarker } from '../../../shared/agent-launch/environment/structured-session-marker'
import {
  readInjectedAgentSessionId,
  readInjectedBotToken
} from '../../../shared/agent-session/lifecycle/launch/agent-session-caller-env'

const REFUSED_FROM_AN_AGENT =
  'a service has no terminal or chat of its own, so --as-service is refused from inside an Orca terminal or chat: ' +
  "mail from there carries that agent's identity. Send without --as-service."

/** An agent's mail is held to whom its turn is for; --as-service would drop that, so only a process with no Orca identity may use it. */
export function assertServiceSend(
  flags: Map<string, string | boolean>,
  to: string | undefined,
  type: string | undefined
): void {
  const invalid = (message: string): RuntimeClientError =>
    new RuntimeClientError('invalid_argument', `${message} Nothing was sent.`)
  if (to === undefined || parseBotAddress(to) === null) {
    throw invalid('--as-service mails a bot, so send it with --to bot:<name>.')
  }
  if (getOptionalStringFlag(flags, 'from') || getOptionalStringFlag(flags, 'on')) {
    throw invalid(
      '--as-service sends as no terminal, so it takes neither --from nor --on (a paired server needs a terminal or chat to answer).'
    )
  }
  if (type === 'worker_done' || type === 'heartbeat') {
    throw invalid(`--type ${type} is a worker's report, which a service has none to make.`)
  }
  if (
    process.env.ORCA_TERMINAL_HANDLE ||
    process.env.ORCA_PANE_KEY ||
    process.env[ORCA_SCRUB_SAFE_PANE_ENV] ||
    process.env.CODEX_THREAD_ID ||
    readInjectedAgentSessionId() ||
    readInjectedBotToken() ||
    hasStructuredSessionMarker()
  ) {
    throw invalid(REFUSED_FROM_AN_AGENT)
  }
}
