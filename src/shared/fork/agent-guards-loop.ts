// Agent guards (FORK.md, SLRM-2385): the failure-loop rule. A finished tool call is a read or a
// wait, a failure or progress; failures with the same signature (tool, input, normalized error)
// since the last progress are counted, and the count decides the warning and the pause. Pure.
import type { AgentGuardSettings } from './agent-guards'

/** One finished tool call as the guard reads it. Inputs and errors are capped before hashing. */
export type AgentGuardToolCall = {
  tool: string
  input: unknown
  failed: boolean
  /** The error text of a failed call (empty when the agent gave none). */
  error: string
  /** Epoch ms the call finished. */
  at: number
}

/**
 * - neutral: a read or a wait. It neither counts nor clears a run: an agent may look at files
 *   between retries, and a poll may fail while it waits.
 * - failed: counts toward its signature's run.
 * - progress: a call that did something and worked. It clears every run.
 */
export type AgentGuardCallClass = 'neutral' | 'failed' | 'progress'

const READ_TOOLS = new Set([
  'read',
  'read_file',
  'readfile',
  'view',
  'grep',
  'glob',
  'ls',
  'list_dir',
  'list_directory',
  'notebookread',
  'webfetch',
  'web_fetch',
  'websearch',
  'web_search',
  'todoread',
  'todowrite',
  'update_plan',
  'bashoutput',
  'taskoutput',
  'monitor',
  'write_stdin',
  'search',
  'find',
  'find_files',
  'search_files',
  'codebase_search',
  'toolsearch'
])

const SHELL_TOOLS = new Set([
  'bash',
  'shell',
  'exec_command',
  'local_shell',
  'run_shell_command',
  'run_terminal_cmd',
  'execute_command',
  'terminal',
  'command'
])

/** Commands that only read, as the first word of each part of a command line. */
const READ_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'wc',
  'ls',
  'rg',
  'grep',
  'egrep',
  'fgrep',
  'pwd',
  'echo',
  'printf',
  'which',
  'type',
  'file',
  'stat',
  'tree',
  'du',
  'df',
  'jq',
  'diff',
  'cut',
  'basename',
  'dirname',
  'realpath',
  'date',
  'true'
])

const READ_GIT = new Set([
  'status',
  'log',
  'diff',
  'show',
  'branch',
  'rev-parse',
  'remote',
  'ls-files',
  'blame'
])

/** Waits and polls on something else: never a failing step of their own. */
const WAIT_PATTERN =
  /(^|[\s;&|(])(sleep|timeout|wait)(\s|$)|--watch\b|\bgh\s+run\s+(watch|view|list)\b|\bgh\s+pr\s+checks\b/

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.entries(value).find(([name]) => name === key)?.[1]
    : undefined
}

const isText = (part: unknown): part is string => typeof part === 'string'

function shellCommand(input: unknown): string | null {
  const raw = field(input, 'command') ?? field(input, 'cmd') ?? input
  if (typeof raw === 'string') {
    return raw
  }
  if (Array.isArray(raw) && raw.every(isText)) {
    // Codex runs `bash -lc "<line>"`: the line is what was asked for.
    const parts = raw.filter(isText)
    const shell = parts.findIndex((part) => part === '-c' || part === '-lc')
    return shell !== -1 && parts[shell + 1] ? parts[shell + 1] : parts.join(' ')
  }
  return null
}

/** True when every part of a command line only reads. Redirection into a file never does. */
export function agentGuardReadOnlyCommand(command: string): boolean {
  const line = command.replace(/\s*2>&1/g, '').replace(/\s*\d?>\s*\/dev\/null/g, '')
  if (/>|<\(|`|\$\(/.test(line)) {
    return false
  }
  const parts = line.split(/\|\||&&|[|;\n]/).map((part) => part.trim())
  return parts.every((part) => {
    if (!part) {
      return true
    }
    const words = part.split(/\s+/)
    const [first, second] = words
    if (first === 'git') {
      return READ_GIT.has(second ?? '') && !part.includes('--output')
    }
    if (first === 'sed') {
      return words.includes('-n') && !/\s-i|--in-place|\sw\s|\/w\s|[;\s]e\b/.test(part)
    }
    if (first === 'find') {
      return !/\s-(exec|execdir|delete|ok|fprint)/.test(part)
    }
    if (first === 'rg') {
      return !part.includes('--pre')
    }
    return READ_COMMANDS.has(first)
  })
}

export function classifyAgentGuardCall(
  call: Pick<AgentGuardToolCall, 'tool' | 'input' | 'failed'>
): AgentGuardCallClass {
  const tool = call.tool.trim().toLowerCase()
  if (READ_TOOLS.has(tool)) {
    return 'neutral'
  }
  if (SHELL_TOOLS.has(tool)) {
    const command = shellCommand(call.input)
    if (command !== null && (WAIT_PATTERN.test(command) || agentGuardReadOnlyCommand(command))) {
      return 'neutral'
    }
  }
  return call.failed ? 'failed' : 'progress'
}

const MAX_INPUT_CHARS = 8000
const MAX_ERROR_CHARS = 2000

function canonical(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonical(entry, depth + 1))
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonical(entry, depth + 1)])
  )
}

/** The input as sorted JSON, capped. */
export function agentGuardInputText(input: unknown): string {
  let text: string
  try {
    text = JSON.stringify(canonical(input)) ?? ''
  } catch {
    text = String(input)
  }
  return text.slice(0, MAX_INPUT_CHARS)
}

/**
 * The error with what changes between identical failures taken out: terminal colors, ids,
 * hashes, numbers (times, durations, pids, line counts) and spacing. Case is kept apart.
 */
export function normalizeAgentGuardError(error: string): string {
  return (
    error
      // oxlint-disable-next-line no-control-regex -- stripping terminal escapes is the point
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '#')
      .replace(/\b[0-9a-f]{7,}\b/gi, '#')
      .replace(/\d+(\.\d+)?/g, '#')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .slice(0, MAX_ERROR_CHARS)
  )
}

/** FNV-1a over the text, twice with different seeds: a short, stable key with no crypto import. */
function hash(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193 ^ text.length
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`
}

/** Same tool, same input, same error: the same failing call. */
export function agentGuardSignature(
  call: Pick<AgentGuardToolCall, 'tool' | 'input' | 'error'>
): string {
  return hash(
    `${call.tool.trim().toLowerCase()}\n${agentGuardInputText(call.input)}\n${normalizeAgentGuardError(call.error)}`
  )
}

/** Where one agent's watch stands. Kept in memory; a restart starts a new episode. */
export type AgentGuardLoopTrack = {
  /** Failures per signature since the last progress. */
  runs: Record<string, number>
  /** The signature the warning was about, and when it was sent. */
  warned: { signature: string; count: number; at: number } | null
  /** The tool of the run that reached the warning, for the status line. */
  tool: string
}

export function newAgentGuardLoopTrack(): AgentGuardLoopTrack {
  return { runs: {}, warned: null, tool: '' }
}

/** Most signatures a track keeps; a run past it is dropped oldest first. */
const MAX_RUNS = 64

export type AgentGuardLoopAction =
  | { kind: 'none' }
  | { kind: 'warn'; signature: string; count: number; tool: string }
  | { kind: 'pause'; signature: string; count: number; tool: string }

/**
 * The loop rule. A failed call adds one to its signature's run. A call that worked and is not a
 * read or a wait clears every run and ends the episode. Reads and waits change nothing. When a
 * run reaches `repeats` and no warning was sent this episode, the answer is `warn`. Once the
 * warning was sent, the same signature failing again in a call that finished after the warning
 * answers `pause` (when pausing is on). The caller records the warning with `noteAgentGuardWarned`
 * only once it was delivered, so an undelivered warning is tried again at the next failure.
 */
export function stepAgentGuardLoop(
  track: AgentGuardLoopTrack,
  call: AgentGuardToolCall,
  settings: Pick<AgentGuardSettings, 'repeats' | 'pauseAfterWarning'>
): AgentGuardLoopAction {
  const kind = classifyAgentGuardCall(call)
  if (kind === 'neutral') {
    return { kind: 'none' }
  }
  if (kind === 'progress') {
    track.runs = {}
    track.warned = null
    return { kind: 'none' }
  }
  const signature = agentGuardSignature(call)
  const count = (track.runs[signature] ?? 0) + 1
  delete track.runs[signature]
  track.runs[signature] = count
  const keys = Object.keys(track.runs)
  if (keys.length > MAX_RUNS) {
    delete track.runs[keys[0]]
  }
  const tool = call.tool.slice(0, 80)
  if (track.warned) {
    if (
      settings.pauseAfterWarning &&
      track.warned.signature === signature &&
      call.at > track.warned.at
    ) {
      return { kind: 'pause', signature, count, tool }
    }
    return { kind: 'none' }
  }
  return count >= settings.repeats ? { kind: 'warn', signature, count, tool } : { kind: 'none' }
}

export function noteAgentGuardWarned(
  track: AgentGuardLoopTrack,
  action: { signature: string; count: number; tool: string },
  at: number
): void {
  track.warned = { signature: action.signature, count: action.count, at }
  track.tool = action.tool
}

/** The one message a looping agent gets. Fixed words: it never quotes the tool, input or output. */
export const AGENT_GUARD_LOOP_MESSAGE =
  '[agent-guard: automatic note] The same tool call has failed with the same error several times in a row. Stop retrying it. Change approach: re-read the error, check your assumptions, try a different method, or stop and say what is blocking you. If it fails the same way again you will be paused for a person to look.'
