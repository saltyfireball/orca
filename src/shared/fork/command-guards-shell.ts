// Command guards (FORK.md, BAD-686): a conservative reader for the shell text of an agent's Bash
// call. It never runs anything. It splits the text into simple commands (words), looks through
// wrappers (sudo, env, xargs, bash -c, eval) and tracks `cd`, and says when it could not read the
// text so the rules can refuse a risky verb they cannot see into. Heredoc bodies are data unless
// the command that reads them may run them (a shell, ssh, a pipe into one, a process substitution).

import { tokenize, type Segment } from './command-guards-tokens'
import {
  COMPOUND_ENDS,
  COMPOUND_WORDS,
  SHELLS,
  SUBSTITUTION,
  VARIABLE_SETTERS,
  baseName,
  blank,
  brief,
  expandKnown,
  functionNames,
  isLiteral,
  isShellReader,
  type Vars
} from './command-guards-words'

export type SimpleCommand = {
  /** The command's base name: `/bin/rm` is `rm`. */
  name: string
  args: string[]
  /** The directory the call starts in, after the `cd`s before it; null when a `cd` was unreadable. */
  cwd: string | null
  /** The arguments also come from standard input (xargs), so the paths are unknown. */
  stdinArgs: boolean
}

/** What could not be read: the part of the text and why, so the agent can reword it. */
export type ShellProblem = {
  why: string
  part: string
  /** The text the problem sits in, without heredoc bodies that are data: where a risky word counts. */
  scope: string
}

export type ShellRead = {
  commands: SimpleCommand[]
  readable: boolean
  problem: ShellProblem | null
}

const MAX_DEPTH = 5
const MAX_COMMANDS = 200
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '}'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const REDIRECT = /^\d*[<>]/
const XARGS_WITH_VALUE = new Set(['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a'])
const SUDO_WITH_VALUE = new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-R'])
const PLAIN_WRAPPERS = new Set([
  'command',
  'builtin',
  'exec',
  'nohup',
  'time',
  'setsid',
  'stdbuf',
  'caffeinate'
])

/** Drops redirections (`2>&1`, `> file`) with their target word. */
function withoutRedirects(words: string[]): string[] {
  const kept: string[] = []
  for (let i = 0; i < words.length; i += 1) {
    if (REDIRECT.test(words[i])) {
      if (/^\d*[<>]+$/.test(words[i])) {
        i += 1
      }
      continue
    }
    kept.push(words[i])
  }
  return kept
}

type Unwrapped = { words: string[]; stdinArgs: boolean } | null

function skipOptions(words: string[], withValue: ReadonlySet<string>): string[] {
  let i = 1
  while (i < words.length && words[i].startsWith('-') && words[i] !== '--') {
    i += withValue.has(words[i]) ? 2 : 1
  }
  return words.slice(i + (words[i] === '--' ? 1 : 0))
}

/** Looks through `sudo`, `env`, `xargs` and friends to the command they run. */
function unwrap(input: string[]): Unwrapped {
  let words = input
  let stdinArgs = false
  for (let guard = 0; guard < 12; guard += 1) {
    while (words.length > 0 && (ASSIGNMENT.test(words[0]) || KEYWORDS.has(words[0]))) {
      words = words.slice(1)
    }
    if (words.length === 0) {
      return null
    }
    const name = baseName(words[0])
    if (name === 'sudo' || name === 'doas') {
      words = skipOptions(words, SUDO_WITH_VALUE)
    } else if (name === 'env') {
      words = skipOptions(words, new Set(['-u', '-C', '-S']))
    } else if (name === 'xargs') {
      stdinArgs = true
      words = skipOptions(words, XARGS_WITH_VALUE)
    } else if (name === 'nice' || name === 'ionice') {
      words = skipOptions(words, new Set(['-n', '-c']))
    } else if (name === 'timeout') {
      words = skipOptions(words, new Set(['-s', '-k'])).slice(1)
    } else if (PLAIN_WRAPPERS.has(name)) {
      words = skipOptions(words, new Set())
    } else {
      return { words, stdinArgs }
    }
  }
  return null
}

function joinCwd(cwd: string | null, target: string | undefined): string | null {
  if (cwd === null || target === undefined || /[$`*?[]/.test(target) || target === '-') {
    return null
  }
  if (target.startsWith('/')) {
    return target
  }
  return `${cwd.replace(/\/+$/, '')}/${target}`
}

type ReadState = {
  out: SimpleCommand[]
  readable: boolean
  home: string | null
  problem: ShellProblem | null
}

function fail(state: ReadState, why: string, part: string, scope: string): void {
  state.readable = false
  state.problem ??= { why, part: brief(part), scope }
}

/** Whether the pipeline this segment feeds ends in something that may run its input as commands. */
function feedsShell(segments: Segment[], index: number): boolean {
  for (let i = index; segments[i]?.end === '|' && i + 1 < segments.length; i += 1) {
    const next = segments[i + 1]
    const unwrapped = unwrap(withoutRedirects(next.words))
    if (
      COMPOUND_WORDS.has(next.words[0] ?? '') ||
      (unwrapped !== null && isShellReader(unwrapped.words))
    ) {
      return true
    }
  }
  return false
}

function read(
  input: string,
  startCwd: string | null,
  state: ReadState,
  depth: number,
  exec: boolean,
  inherited: Vars
): void {
  if (depth > MAX_DEPTH) {
    fail(state, 'it nests wrappers (bash -c, eval, $( )) too deeply', input, input)
    return
  }
  const tokens = tokenize(input)
  const trouble: { why: string; part: string }[] = []
  const dataRanges: [number, number][] = []
  if (tokens.unclosedAt >= 0) {
    trouble.push({ why: 'a quote is never closed', part: input.slice(tokens.unclosedAt) })
  }
  if (tokens.badHeredoc) {
    trouble.push({ why: 'a << has no delimiter word after it', part: input })
  }
  const { segments } = tokens
  const vars: Vars = new Map(inherited)
  const functions = functionNames(input)
  let compound = false
  let cwd = startCwd
  const dynamic = segments.some((seg) => {
    const first = unwrap(withoutRedirects(seg.words))?.words[0]
    return first !== undefined && VARIABLE_SETTERS.has(baseName(first))
  })
  segments.forEach((seg, index) => {
    const raw = withoutRedirects(seg.words)
    const unwrapped = unwrap(raw)
    const previous = segments[index - 1]?.end ?? ''
    const settled = ['', ';', '\n'].includes(previous) && ['', ';', '\n', '&&'].includes(seg.end)
    if (COMPOUND_WORDS.has(seg.words[0] ?? '') || seg.end === '(' || seg.proc) {
      compound = true
    }
    const bare = raw.slice(raw.findIndex((word) => !COMPOUND_WORDS.has(word) && word !== '!'))
    const assigned = bare.length > 0 && bare.every((word) => ASSIGNMENT.test(word))
    const exported = bare[0] === 'export' || bare[0] === 'readonly' ? bare.slice(1) : null
    for (const word of assigned ? bare : (exported ?? [])) {
      const eq = word.indexOf('=')
      if (eq > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(word.slice(0, eq))) {
        const value = expandKnown(word.slice(eq + 1), vars)
        vars.set(
          word.slice(0, eq),
          !dynamic && settled && !compound && isLiteral(value) ? value : null
        )
      }
    }
    for (const word of raw.slice(0, 1)) {
      const name = /^([A-Za-z_][A-Za-z0-9_]*)\+=/.exec(word)?.[1]
      if (name) {
        vars.set(name, null)
      }
    }
    if (dynamic) {
      vars.clear()
    }
    const runs =
      exec ||
      seg.proc ||
      COMPOUND_ENDS.has(seg.words[0] ?? '') ||
      (unwrapped !== null &&
        (isShellReader(unwrapped.words) || functions.has(baseName(unwrapped.words[0])))) ||
      feedsShell(segments, index)
    for (const doc of seg.docs) {
      if (runs || doc.unterminated) {
        read(doc.body, cwd, state, depth + 1, true, new Map())
      } else if (doc.kind === 'heredoc') {
        dataRanges.push(doc.range)
      }
      if (!runs && !doc.unterminated && doc.kind === 'heredoc' && !doc.quoted) {
        for (const match of doc.body.matchAll(SUBSTITUTION)) {
          read(match[1] ?? match[2] ?? '', cwd, state, depth + 1, false, new Map())
        }
      }
    }
    if (!unwrapped || state.out.length > MAX_COMMANDS) {
      return
    }
    const [first, ...rest] = unwrapped.words
    const args = rest.map((arg) => expandKnown(arg, vars))
    const name = baseName(first)
    if (name === 'cd' || name === 'pushd') {
      const target = args.find((arg) => !arg.startsWith('-'))
      cwd =
        target === undefined || target === '~'
          ? state.home
          : target.startsWith('~/') && state.home
            ? `${state.home}${target.slice(1)}`
            : joinCwd(cwd, target)
      return
    }
    const inline = SHELLS.has(name)
      ? args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg))
      : name === 'eval'
        ? -2
        : -1
    if (inline >= 0 && args[inline + 1] !== undefined) {
      read(args[inline + 1], cwd, state, depth + 1, true, vars)
    } else if (inline === -2) {
      read(args.join(' '), cwd, state, depth + 1, true, vars)
    }
    state.out.push({ name, args, cwd, stdinArgs: unwrapped.stdinArgs })
  })
  const scope = blank(input, dataRanges)
  for (const { why, part } of trouble) {
    fail(state, why, part, scope)
  }
  // Substitutions inside double quotes are not split above; read them as commands of their own.
  for (const match of input.matchAll(SUBSTITUTION)) {
    const at = match.index ?? 0
    if (!tokens.bodies.some(([from, to]) => at >= from && at < to)) {
      read(match[1] ?? match[2] ?? '', startCwd, state, depth + 1, exec, new Map())
    }
  }
}

/** The simple commands of `command`, and whether all of it could be read. */
export function readShellCommands(
  command: string,
  startCwd: string | null,
  home: string | null
): ShellRead {
  const state: ReadState = { out: [], readable: true, home, problem: null }
  read(command, startCwd, state, 0, false, new Map())
  return {
    commands: state.out,
    readable: state.readable,
    problem: state.problem
  }
}
