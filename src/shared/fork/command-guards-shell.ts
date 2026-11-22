// Command guards (FORK.md, BAD-686): a conservative reader for the shell text of an agent's Bash
// call. It never runs anything. It splits the text into simple commands (words), looks through
// wrappers (sudo, env, xargs, bash -c, eval) and tracks `cd`, and says when it could not read the
// text so the rules can refuse a risky verb they cannot see into.

export type SimpleCommand = {
  /** The command's base name: `/bin/rm` is `rm`. */
  name: string
  args: string[]
  /** The directory the call starts in, after the `cd`s before it; null when a `cd` was unreadable. */
  cwd: string | null
  /** The arguments also come from standard input (xargs), so the paths are unknown. */
  stdinArgs: boolean
}

export type ShellRead = { commands: SimpleCommand[]; readable: boolean }

const MAX_DEPTH = 5
const MAX_COMMANDS = 200
const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')', '`'])
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '}'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])
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

function splitSegments(input: string): { segments: string[][]; closed: boolean } {
  const segments: string[][] = []
  let words: string[] = []
  let word = ''
  let inWord = false
  let single = false
  let double = false
  const endWord = (): void => {
    if (inWord) {
      words.push(word)
    }
    word = ''
    inWord = false
  }
  const endSegment = (): void => {
    endWord()
    if (words.length > 0) {
      segments.push(words)
    }
    words = []
  }
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i]
    if (single) {
      single = c !== "'"
      word += single ? c : ''
    } else if (double) {
      if (c === '"') {
        double = false
      } else if (c === '\\' && i + 1 < input.length) {
        i += 1
        word += input[i]
      } else {
        word += c
      }
    } else if (c === '\\' && i + 1 < input.length) {
      i += 1
      if (input[i] !== '\n') {
        word += input[i]
        inWord = true
      }
    } else if (c === "'") {
      single = true
      inWord = true
    } else if (c === '"') {
      double = true
      inWord = true
    } else if (c === '#' && !inWord) {
      while (i + 1 < input.length && input[i + 1] !== '\n') {
        i += 1
      }
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
    } else if (SEPARATORS.has(c)) {
      endSegment()
    } else {
      word += c
      inWord = true
    }
  }
  endSegment()
  return { segments, closed: !single && !double }
}

function baseName(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1)
}

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

type ReadState = { out: SimpleCommand[]; readable: boolean; home: string | null }

function read(input: string, startCwd: string | null, state: ReadState, depth: number): void {
  if (depth > MAX_DEPTH) {
    state.readable = false
    return
  }
  const { segments, closed } = splitSegments(input)
  if (!closed) {
    state.readable = false
  }
  let cwd = startCwd
  for (const raw of segments) {
    const unwrapped = unwrap(withoutRedirects(raw))
    if (!unwrapped || state.out.length > MAX_COMMANDS) {
      continue
    }
    const [first, ...args] = unwrapped.words
    const name = baseName(first)
    if (name === 'cd' || name === 'pushd') {
      const target = args.find((arg) => !arg.startsWith('-'))
      cwd =
        target === undefined || target === '~'
          ? state.home
          : target.startsWith('~/') && state.home
            ? `${state.home}${target.slice(1)}`
            : joinCwd(cwd, target)
      continue
    }
    const inline = SHELLS.has(name)
      ? args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg))
      : name === 'eval'
        ? -2
        : -1
    if (inline >= 0 && args[inline + 1] !== undefined) {
      read(args[inline + 1], cwd, state, depth + 1)
    } else if (inline === -2) {
      read(args.join(' '), cwd, state, depth + 1)
    }
    state.out.push({ name, args, cwd, stdinArgs: unwrapped.stdinArgs })
  }
  // Substitutions inside double quotes are not split above; read them as commands of their own.
  for (const match of input.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) {
    read(match[1] ?? match[2] ?? '', startCwd, state, depth + 1)
  }
}

/** The simple commands of `command`, and whether all of it could be read. */
export function readShellCommands(
  command: string,
  startCwd: string | null,
  home: string | null
): ShellRead {
  const state: ReadState = { out: [], readable: true, home }
  read(command, startCwd, state, 0)
  return { commands: state.out, readable: state.readable }
}
