// SLRM-1394: the chat-survive broker process. The app runs it (Electron as Node, detached) in
// place of a provider supervisor:
//
//   app -> broker (this file) -> provider supervisor -> provider
//
// While the app lives, the broker is a transparent pipe: stdin, stdout, stderr, the close request
// (stdin end) and stop signals reach the supervisor as they would directly, and this process exits
// with the supervisor's code or signal, so the app's exit proof is unchanged. When the app dies the
// provider keeps running and its output goes to the broker's rings until a new owner attaches over
// the socket or the orphan timeout stops it. The supervisor treats the broker as its owner, so the
// provider dies with the broker.
//
// Loaded under plain Node: keep this graph free of Electron and of lazy loads, because an update
// can replace the app bundle while a broker still runs.
import { dirname } from 'node:path'
import { startChatSurviveBroker } from './chat-survive-broker'
import { prepareChatSurviveSocketDir } from './chat-survive-launch'
import {
  CHAT_SURVIVE_SPEC_ENV,
  parseChatSurviveBrokerSpec,
  supervisorEnvOwnedBy
} from './chat-survive-broker-spec'
import { PROVIDER_SUPERVISOR_MAX_STOP_MS } from '../../provider-process/provider-process-supervisor'

/** The supervisor's whole stop budget, so the broker never SIGKILLs it while it stops its group. */
const SUPERVISOR_STOP_GRACE_MS = PROVIDER_SUPERVISOR_MAX_STOP_MS + 1_000

function fail(message: string, code: number): never {
  try {
    process.stderr.write(`[chat-survive-broker] ${message}\n`)
  } catch {
    // Nothing to tell.
  }
  process.exit(code)
}

async function main(): Promise<void> {
  const spec = parseChatSurviveBrokerSpec(process.env[CHAT_SURVIVE_SPEC_ENV])
  if (!spec) {
    fail('missing or unreadable spec', 2)
  }
  // The app can die before this runs; a provider started now would have no owner at all.
  if (process.ppid !== spec.ownerPid) {
    process.exit(1)
  }
  // The app's group guard listens for a supervisor's group report; the broker has none to send.
  if (typeof process.disconnect === 'function' && process.connected) {
    process.disconnect()
  }
  const separator = process.argv.indexOf('--', 2)
  const [command, ...args] = separator === -1 ? [] : process.argv.slice(separator + 1)
  if (!command) {
    fail('no provider command after --', 2)
  }
  const inherited: NodeJS.ProcessEnv = { ...process.env }
  delete inherited[CHAT_SURVIVE_SPEC_ENV]
  const env = supervisorEnvOwnedBy(inherited, process.pid)
  if (!env) {
    // Without a supervisor that answers to the broker, the provider would outlive everything.
    fail('the provider command is not a provider supervisor', 2)
  }
  // The app checked the folder before this spawn; the system may have cleaned it up since.
  if (!(await prepareChatSurviveSocketDir(dirname(spec.socketPath)))) {
    fail('the socket folder is not private', 2)
  }
  const broker = await startChatSurviveBroker({
    command,
    args,
    env,
    socketPath: spec.socketPath,
    token: spec.token,
    orphanTimeoutMs: spec.orphanTimeoutMs,
    detached: false,
    stopGraceMs: SUPERVISOR_STOP_GRACE_MS,
    directOwner: {
      input: process.stdin,
      output: process.stdout,
      errOutput: process.stderr,
      gone: () => process.ppid !== spec.ownerPid
    }
  })
  // A stop from the app (or anyone after it) is a stop of the provider, as with the supervisor.
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(signal, () => void broker.close())
  }
  const end = await broker.done
  if (end.reason === 'spawn-failed') {
    fail('could not start the provider supervisor', 127)
  }
  const signal = end.exit?.signal
  if (signal) {
    // Re-raise with the default action; the handlers above would swallow it.
    process.removeAllListeners(signal)
    process.kill(process.pid, signal)
    return
  }
  process.exit(end.exit?.code ?? 1)
}

void main().catch((error: unknown) => fail(String(error), 1))
