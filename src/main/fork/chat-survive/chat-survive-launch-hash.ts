// SLRM-1394: a fingerprint of what a chat's provider was started with, so the next app instance
// adopts a surviving provider only when it would start the same one. A running CLI keeps its
// launch args and env (model, permission mode, MCP config, settings), and a new SDK query that
// expects others would talk to the wrong provider; then adoption is refused and the chat starts
// as today.
//
// The fingerprint is a set of named parts, one hash each: the command, the cwd, the session, each
// arg flag, the order of the flags and each provider env key. Two launches match when every part
// does, and a mismatch can say which parts differ by name, never by value. What only describes
// the app run (its version, per-spawn tokens) is not a part, so an app update alone changes
// nothing here.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { PipedProcessSpec } from '@orca/process-host/process-spec'
import { ORCA_AGENT_SESSION_SPAWN_TOKEN_ENV } from '../../../shared/agent-session/lifecycle/launch/agent-session-caller-env'
import { AGENT_HOOK_RUNTIME_ENV_KEYS } from '../../ipc/pty/host-env/spawn-env-keys'
import { isProviderSupervisorSpawn } from './chat-survive-launch'
import { isRecord } from './chat-survive-protocol'

/** The fingerprint format. A record with any other one (or the earlier single hash) is not adopted. */
export const CHAT_SURVIVE_LAUNCH_VERSION = 2

export type ChatSurviveLaunchPrint = {
  v: typeof CHAT_SURVIVE_LAUNCH_VERSION
  /** Part name (`cwd`, `arg:--model`, `env:CLAUDE_CONFIG_DIR`) to the hex sha256 of its value. */
  parts: Record<string, string>
}

/** Env that configures the provider. The rest (PATH, XPC names, per-launch noise) is not a part. */
const PROVIDER_ENV = /^(?:ANTHROPIC_|CLAUDE|ORCA_|MCP_|DISABLE_|ENABLE_)/

/**
 * Per spawn or per app run, and never what the provider runs with: left out. The app version is
 * put in the app's own environment for its terminals and updater; no provider reads it, and it
 * changes on every update.
 */
const PER_RUN_ENV = new Set<string>([
  ORCA_AGENT_SESSION_SPAWN_TOKEN_ENV,
  ...AGENT_HOOK_RUNTIME_ENV_KEYS,
  'ORCA_APP_VERSION'
])

/** A first launch names the session with `--session-id`, a later one with `--resume`. */
const SESSION_FLAGS = new Set(['--session-id', '--resume'])

/**
 * Flags whose value may name a file the provider reads at start. Such a file can keep its path
 * and change its content between two launches (the MCP config of a chat is rewritten in place on
 * every start), so its content is part of the value.
 */
const FILE_FLAGS = new Set([
  '--mcp-config',
  '--settings',
  '--system-prompt-file',
  '--append-system-prompt-file'
])

/** Larger than any config file; more is not read and counts as unreadable. */
const MAX_FILE_BYTES = 4 * 1024 * 1024

const HASH = /^[0-9a-f]{64}$/
const MAX_PARTS = 512

function digest(name: string, value: string): string {
  return createHash('sha256').update(`${name}\0${value}`).digest('hex')
}

/** What a file-flag value stands for: inline JSON as it is, a file by its path and content. */
function fileValue(value: string, readFile: (path: string) => string | null): string {
  if (value.trimStart().startsWith('{')) {
    return value
  }
  const content = readFile(value)
  // An unreadable file reads the same on both launches only while it stays unreadable.
  return JSON.stringify([value, content === null ? null : digest('file', content)])
}

function readLaunchFile(path: string): string | null {
  try {
    // The spawn hook is synchronous and the provider reads this file right after it.
    const content = readFileSync(path)
    return content.length > MAX_FILE_BYTES ? null : content.toString('utf8')
  } catch {
    return null
  }
}

type LaunchArgs = {
  /** Flag name to its values, one list per time the flag is given, in order. */
  flags: Map<string, string[][]>
  /** Every flag as given, session flags aside. */
  order: string[]
  /** Values before the first flag. */
  leading: string[]
  session: string[]
}

/**
 * The args by flag. The SDK writes a flag as `--flag=value` or as `--flag value`, and the session
 * flag in another place for a resume than for a first launch, so the session is taken out of line
 * and each flag is compared by name. A value that follows a flag belongs to it.
 */
function launchArgs(args: readonly string[]): LaunchArgs {
  const parsed: LaunchArgs = { flags: new Map(), order: [], leading: [], session: [] }
  let values: string[] = parsed.leading
  for (const arg of args) {
    if (!arg.startsWith('-') || arg === '-') {
      values.push(arg)
      continue
    }
    const at = arg.indexOf('=')
    const flag = at === -1 ? arg : arg.slice(0, at)
    if (SESSION_FLAGS.has(flag)) {
      values = parsed.session
    } else {
      values = []
      parsed.order.push(flag)
      parsed.flags.set(flag, [...(parsed.flags.get(flag) ?? []), values])
    }
    if (at !== -1) {
      values.push(arg.slice(at + 1))
    }
  }
  return parsed
}

function launchParts(
  spec: PipedProcessSpec,
  env: Record<string, string | undefined>,
  readFile: (path: string) => string | null
): Record<string, string> | null {
  if (!isProviderSupervisorSpawn(spec)) {
    return null
  }
  // After the supervisor's `-e SCRIPT --`: the provider command and its args.
  const [command = '', ...rest] = (spec.args ?? []).slice(3)
  const { flags, order, leading, session } = launchArgs(rest)
  const parts: Record<string, string> = {}
  const put = (name: string, value: unknown): void => {
    parts[name] = digest(name, JSON.stringify(value))
  }
  put('command', command)
  put('cwd', spec.cwd ?? null)
  put('session', session)
  put('args', leading)
  put('arg order', order)
  for (const [flag, given] of flags) {
    put(
      `arg:${flag}`,
      FILE_FLAGS.has(flag)
        ? given.map((values) => values.map((value) => fileValue(value, readFile)))
        : given
    )
  }
  for (const key of Object.keys(env)) {
    if (PROVIDER_ENV.test(key) && !PER_RUN_ENV.has(key) && env[key] !== undefined) {
      put(`env:${key}`, env[key])
    }
  }
  return parts
}

/**
 * The fingerprint of a provider supervisor spawn: its provider command and args (after the
 * supervisor's `--`), its cwd and its provider env. Null for any other spawn.
 */
export function chatSurviveLaunchPrint(
  spec: PipedProcessSpec,
  env: Record<string, string | undefined>,
  readFile: (path: string) => string | null = readLaunchFile
): ChatSurviveLaunchPrint | null {
  const parts = launchParts(spec, env, readFile)
  return parts ? { v: CHAT_SURVIVE_LAUNCH_VERSION, parts } : null
}

/** A saved fingerprint in this format, else null: an older or damaged one matches nothing. */
export function readChatSurviveLaunchPrint(value: unknown): ChatSurviveLaunchPrint | null {
  if (!isRecord(value) || value.v !== CHAT_SURVIVE_LAUNCH_VERSION || !isRecord(value.parts)) {
    return null
  }
  const entries = Object.entries(value.parts)
  if (entries.length === 0 || entries.length > MAX_PARTS) {
    return null
  }
  const parts: Record<string, string> = {}
  for (const [name, hash] of entries) {
    if (typeof hash !== 'string' || !HASH.test(hash)) {
      return null
    }
    parts[name] = hash
  }
  return { v: CHAT_SURVIVE_LAUNCH_VERSION, parts }
}

/**
 * The names of the parts in which two fingerprints differ, sorted: one that changed, one only the
 * saved launch had and one only this launch has. Empty when they are the same launch. Names only
 * (arg flags and env keys), so the answer is safe to log.
 */
export function chatSurviveLaunchDiff(
  saved: ChatSurviveLaunchPrint,
  now: ChatSurviveLaunchPrint
): string[] {
  const names = new Set([...Object.keys(saved.parts), ...Object.keys(now.parts)])
  return [...names]
    .filter(
      (name) =>
        !Object.hasOwn(saved.parts, name) ||
        !Object.hasOwn(now.parts, name) ||
        saved.parts[name] !== now.parts[name]
    )
    .sort()
}
