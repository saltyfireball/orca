// Fork BAD-747: what "Open in terminal" may type for a step, and which computer a step's host names.
// The text goes in as a paste and is never submitted: the owner presses Enter. Pure.
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../execution-host/execution-host'
import { isBotItemStepCommandSafe, normalizeBotItemStepCommand } from './bot-item-steps'

export type BotItemStepTyping =
  | { ok: true; text: string }
  | { ok: false; reason: 'none' | 'unsafe' | 'multiline' }

/** The exact text to type, or why not. A command with a control, escape or hidden character is refused
 *  (so nothing in it can end a paste early or run itself), and so is one with a line that is not
 *  continued by a trailing backslash: without bracketed paste a shell would run those lines. Such a
 *  command is still shown and copied whole. */
export function botItemStepTyping(command: string | undefined): BotItemStepTyping {
  const text = normalizeBotItemStepCommand(command ?? '')
  if (!text) {
    return { ok: false, reason: 'none' }
  }
  if (!isBotItemStepCommandSafe(text)) {
    return { ok: false, reason: 'unsafe' }
  }
  const lines = text.split('\n')
  return lines.slice(0, -1).every((line) => line.endsWith('\\'))
    ? { ok: true, text }
    : { ok: false, reason: 'multiline' }
}

function key(name: string): string {
  return name.trim().toLowerCase()
}

/** The host a step's `host` names, among the hosts Orca knows by label, this computer by its own names
 *  (its machine name, `local`, `this computer`). Null when none matches: Open in terminal is then off. */
export function matchBotItemStepHost(
  name: string,
  hosts: readonly { id: ExecutionHostId; label: string }[],
  thisComputerNames: readonly string[]
): ExecutionHostId | null {
  const wanted = key(name)
  if (!wanted) {
    return null
  }
  const found = hosts.find((host) => key(host.label) === wanted)
  if (found) {
    return found.id
  }
  const local = ['local', 'this computer', ...thisComputerNames].map(key)
  return local.includes(wanted) ? LOCAL_EXECUTION_HOST_ID : null
}
