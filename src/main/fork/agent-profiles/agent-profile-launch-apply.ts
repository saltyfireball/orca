// FORK.md "Agent profiles" (BAD-741): the hooks that apply a `--profile` launch's scope. Each goes
// through the mechanism the agent already has: the permission mode as the launch's own permission
// session option (terminal flags, or the chat's permission mode), the Claude account as an account
// pin (SLRM-1503), the preamble in front of the worker's task. Outside a scope nothing changes.
import { AGENT_CHAT_PERMISSION_MODE_OPTION_ID } from '../../../shared/agent-launch/permissions/agent-chat-permission-mode-option-id'
import { readLaunchPermissionChoice } from '../../../shared/agent-launch/permissions/tui-agent-permission-choice'
import type { AgentLaunchPreferences } from '../../../shared/agent-session/lifecycle/operations/agent-session-host-authority'
import {
  forkProfilePermissionSurfaces,
  withForkProfilePreamble
} from '../../../shared/fork/agent-profiles/agent-profile-launch'
import {
  FORK_CLAUDE_SYSTEM_DEFAULT,
  FORK_CLAUDE_TERMINAL_ACCOUNT_ENV
} from '../../../shared/fork/claude-account-move'
import { claudeSessionAccountPins } from '../claude-account-move/claude-session-account-pins'
import { currentForkAgentProfileLaunch } from './agent-profile-launch-scope'
import {
  assertForkMcpProfileApplies,
  currentForkMcpLaunchScope
} from '../mcp-profiles/mcp-launch-scope'
import { forkTaskProfilePreamble } from './agent-profile-task-store'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { writeStructuredAgentSessionOrcaNote } from '../../native-chat/agent-session-wire/structured-agent-session-orca-note'

type TerminalLaunch = {
  startupAgent?: string
  launchPreferences?: AgentLaunchPreferences
  accountEnv?: Record<string, string>
}

/** The terminal plan hook: a profile's mode becomes the launch's permission choice, its Claude
 *  account the pane's own account marker. */
export function forkAgentProfileTerminalLaunch<O extends TerminalLaunch, S>(
  opts: O,
  sessionOptions: Readonly<Record<string, S | string>> | undefined
): { opts: O; sessionOptions: Readonly<Record<string, S | string>> | undefined } {
  if (opts.startupAgent) {
    // An MCP profile narrows only Claude; a terminal of any other agent refuses it.
    assertForkMcpProfileApplies(currentForkMcpLaunchScope()?.profile, {
      agent: opts.startupAgent
    })
  }
  const launch = currentForkAgentProfileLaunch()
  if (!launch || !opts.startupAgent || opts.startupAgent !== launch.agent) {
    return { opts, sessionOptions }
  }
  let next = opts
  let options = sessionOptions
  const mode = launch.permissionMode
  if (mode && forkProfilePermissionSurfaces(launch.agent, mode).terminal) {
    if (options) {
      options = { ...options, [AGENT_CHAT_PERMISSION_MODE_OPTION_ID]: mode }
    } else if (readLaunchPermissionChoice(next.launchPreferences) === undefined) {
      next = { ...next, launchPreferences: { ...next.launchPreferences, mode } }
    }
  }
  if (launch.account?.kind === 'claude') {
    const marker = launch.account.pin ?? FORK_CLAUDE_SYSTEM_DEFAULT
    next = {
      ...next,
      accountEnv: { ...next.accountEnv, [FORK_CLAUDE_TERMINAL_ACCOUNT_ENV]: marker }
    }
  }
  return { opts: next, sessionOptions: options }
}

type ChatCreate = {
  envelope: { sessionId: string }
  provider: string
  agent: string
  location: { wslDistro?: string | null }
  options?: Readonly<Record<string, string>>
}

/** The chat creation hook: the profile's mode seeds the chat's permission, and a Claude chat is
 *  pinned to the profile's account before its first start. A pin that cannot be saved is a note
 *  in the chat (BAD-800), not only a log line. */
export async function forkAgentProfileChatCreate<P extends ChatCreate, R>(
  params: P,
  create: (params: P) => Promise<R>
): Promise<R> {
  assertForkMcpProfileApplies(currentForkMcpLaunchScope()?.profile, { agent: params.provider })
  const launch = currentForkAgentProfileLaunch()
  if (!launch || params.agent !== launch.agent) {
    return create(params)
  }
  let next = params
  const mode = launch.permissionMode
  if (mode && forkProfilePermissionSurfaces(launch.agent, mode).chat) {
    next = { ...next, options: { ...next.options, [AGENT_CHAT_PERMISSION_MODE_OPTION_ID]: mode } }
  }
  if (
    launch.account?.kind !== 'claude' ||
    params.provider !== 'claude' ||
    params.location.wslDistro
  ) {
    return create(next)
  }
  const pinned = claudeSessionAccountPins()
    .set(params.envelope.sessionId, launch.account.pin)
    .then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error))
    )
  const created = await create(next)
  // The note waits for the chat to exist; the create does not wait for the pin file.
  void pinned.then((failure) => {
    if (failure) {
      console.warn('[fork-agent-profiles] Could not save the chat account pin:', failure)
      return noteFailedAccountPin(params.envelope.sessionId, launch.name, failure)
    }
    return undefined
  })
  return created
}

export const FORK_ACCOUNT_PIN_NOTE_ID = 'fork-agent-profile-account-pin'

async function noteFailedAccountPin(sessionId: string, profile: string, why: string) {
  const host = getStructuredAgentSessionHost()
  if (!host) {
    return
  }
  await writeStructuredAgentSessionOrcaNote(host, sessionId, FORK_ACCOUNT_PIN_NOTE_ID, {
    kind: 'status',
    tone: 'warning',
    text: `Profile ${profile}: Orca could not save this chat's Claude account (${why}). It runs on that account now, but after Orca restarts it follows the selected account; use Move to account on this chat to keep it there.`
  }).catch((error: unknown) =>
    console.warn('[fork-agent-profiles] Could not note the failed account pin:', error)
  )
}

/** The worker preamble hook: the profile's preamble in front of the task, once. */
export function forkAgentProfileTaskSpec(taskId: string, spec: string): string {
  const launch = currentForkAgentProfileLaunch()
  return withForkProfilePreamble(spec, launch ? launch.preamble : forkTaskProfilePreamble(taskId))
}
