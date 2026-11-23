// Command guards (FORK.md, BAD-686, BAD-785): word lists and small helpers the shell reader shares.

export const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])
// Commands whose standard input is run as commands (heredoc bodies fed to them are shell text).
export const SHELL_READERS = new Set([
  ...SHELLS,
  'fish',
  'csh',
  'tcsh',
  'rbash',
  'busybox',
  'ssh',
  'su',
  'eval',
  'source',
  '.'
])
// Commands that run another command named in their arguments, possibly a shell reading stdin.
export const COMMAND_RUNNERS = new Set([
  'docker',
  'podman',
  'kubectl',
  'nsenter',
  'chroot',
  'runuser',
  'sg',
  'script',
  'watch',
  'parallel',
  'flock',
  'unshare',
  'lxc',
  'limactl'
])
export const COMPOUND_ENDS = new Set(['done', 'fi', 'esac', '}'])
export const COMPOUND_WORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'while',
  'until',
  'do',
  'for',
  'case',
  'select',
  'function',
  '{'
])
// Commands that can set a variable in ways the reader does not follow.
export const VARIABLE_SETTERS = new Set([
  'eval',
  'read',
  'mapfile',
  'readarray',
  'source',
  '.',
  'getopts',
  'declare',
  'typeset',
  'local',
  'let',
  'unset',
  'set',
  'shift',
  'for',
  'select'
])
// An opener after an odd run of backslashes is escaped: the shell prints it, it runs nothing.
export const SUBSTITUTION = /(?<!(?:^|[^\\])(?:\\\\)*\\)(?:\$\(([^()]*)\)|`([^`]*)`)/g
export const VARIABLE = /\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})/g

export function baseName(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1)
}

export const brief = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 80)

export type Vars = Map<string, string | null>

/** Replaces `$NAME` and `${NAME}` that hold a known literal; unknown ones stay for the rules to refuse. */
export function expandKnown(word: string, vars: Vars): string {
  return word.replace(VARIABLE, (whole, plain?: string, braced?: string) => {
    const value = vars.get(plain ?? braced ?? '')
    return typeof value === 'string' ? value : whole
  })
}

export const isLiteral = (value: string): boolean => !/[$`*?[\s~\\{]/.test(value)

// The variables that name a shell: `$SHELL`, `${SHELL:-sh}`, `$BASH`, `$0`.
const SHELL_VARIABLE = /^\$\{?(SHELL|BASH|0)(?![A-Za-z0-9_])/

export function isShellReader(words: string[], vars: Vars = new Map()): boolean {
  const first = expandKnown(words[0], vars)
  const name = baseName(first)
  return (
    SHELL_VARIABLE.test(first) ||
    SHELL_READERS.has(name) ||
    (COMMAND_RUNNERS.has(name) &&
      words.slice(1).some((arg) => SHELLS.has(baseName(arg.trim().split(/\s+/)[0] ?? ''))))
  )
}

export function functionNames(input: string): Set<string> {
  const names = new Set<string>()
  for (const match of input.matchAll(
    /(?:^|[;&|\n{(]\s*)(?:function\s+)?([A-Za-z_][\w.-]*)\s*\(\s*\)/g
  )) {
    names.add(match[1])
  }
  return names
}

export function blank(input: string, ranges: [number, number][]): string {
  let text = ''
  let at = 0
  for (const [from, to] of [...ranges].sort((x, y) => x[0] - y[0])) {
    text += input.slice(at, from)
    at = to
  }
  return text + input.slice(at)
}
