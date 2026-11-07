// SLRM-1394: a fingerprint of what a chat's provider was started with, so the next app instance
// adopts a surviving provider only when it would start the same one. A running CLI keeps its
// launch args and env (model, permission mode, MCP config, settings), and a new SDK query that
// expects others would talk to the wrong provider; then adoption is refused and the chat starts
// as today.
import { createHash } from 'node:crypto'
import type { PipedProcessSpec } from '@orca/process-host/process-spec'
import { ORCA_AGENT_SESSION_SPAWN_TOKEN_ENV } from '../../../shared/agent-session/lifecycle/agent-session-caller-env'
import { AGENT_HOOK_RUNTIME_ENV_KEYS } from '../../ipc/pty/host-env/spawn-env-keys'
import { isProviderSupervisorSpawn } from './chat-survive-launch'

/** Env that configures the provider. The rest (PATH, XPC names, per-launch noise) is not hashed. */
const PROVIDER_ENV = /^(?:ANTHROPIC_|CLAUDE|ORCA_|MCP_|DISABLE_|ENABLE_)/

/** Per spawn or per app run, and never what the provider runs with: left out. */
const PER_RUN_ENV = new Set<string>([
  ORCA_AGENT_SESSION_SPAWN_TOKEN_ENV,
  ...AGENT_HOOK_RUNTIME_ENV_KEYS
])

/** A first launch names the session with `--session-id`, a later one with `--resume`. */
const SESSION_FLAGS = new Set(['--session-id', '--resume'])

/**
 * The args without the session flag, and the session it names. The SDK writes the flag with `=`
 * and in another place for a resume than for a first launch, so it is taken out of line.
 */
function providerArgs(args: readonly string[]): { args: string[]; session: string[] } {
  const rest: string[] = []
  const session: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    const [flag = '', ...value] = arg.split('=')
    if (!SESSION_FLAGS.has(flag)) {
      rest.push(arg)
    } else if (value.length > 0) {
      session.push(value.join('='))
    } else {
      index += 1
      session.push(args[index] ?? '')
    }
  }
  return { args: rest, session }
}

/**
 * The hex sha256 of the provider command and args (after the supervisor's `--`), its cwd and its
 * provider env; null for anything but a provider supervisor spawn.
 */
export function chatSurviveLaunchHash(
  spec: PipedProcessSpec,
  env: Record<string, string | undefined>
): string | null {
  if (!isProviderSupervisorSpawn(spec)) {
    return null
  }
  const keys = Object.keys(env)
    .filter((key) => PROVIDER_ENV.test(key) && !PER_RUN_ENV.has(key) && env[key] !== undefined)
    .sort()
  const launch = {
    ...providerArgs((spec.args ?? []).slice(3)),
    cwd: spec.cwd ?? null,
    env: keys.map((key) => [key, env[key]])
  }
  return createHash('sha256').update(JSON.stringify(launch)).digest('hex')
}
