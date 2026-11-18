// Approval triage (FORK.md, SLRM-2397): the risk of one shell command. Only a plain chain of
// known read-only programs on files inside the agent's folder is low. A git or GitHub write,
// deleting, the network, privilege, process control, a nested shell and anything that touches a
// credential is high. Everything else, including anything this cannot read whole, is medium.
import { placePath, resolvePath, isInside } from './approval-risk-paths'
import {
  HIGH_PROGRAMS,
  SHELLS,
  INTERPRETERS,
  GIT_READ,
  GIT_BRANCH_READ_FLAGS,
  GH_READ,
  SAFE_READERS,
  PATTERN_FIRST,
  TEXT_ONLY,
  UNSAFE_FLAGS,
  NETWORK,
  UPLOAD_FLAG,
  PACKAGE_MANAGERS,
  GIT_WRITE
} from './approval-risk-words'

export type ForkApprovalRisk = 'low' | 'medium' | 'high'
export type ForkApprovalGrade = { risk: ForkApprovalRisk; reason: string }

const MAX_COMMAND_LENGTH = 2000

type Segment = { words: string[] }
type Split = { segments: Segment[] } | { unreadable: string }

const high = (reason: string): ForkApprovalGrade => ({ risk: 'high', reason })
const medium = (reason: string): ForkApprovalGrade => ({ risk: 'medium', reason })

/** Words and chain parts, honoring quotes. Expansion, redirection, subshells and the like are unreadable. */
export function splitShellCommand(command: string): Split {
  const segments: Segment[] = []
  let words: string[] = []
  let word = ''
  let quote: "'" | '"' | null = null
  let started = false
  const endWord = (): void => {
    if (started) {
      words.push(word)
    }
    word = ''
    started = false
  }
  const endSegment = (): boolean => {
    endWord()
    if (words.length === 0) {
      return false
    }
    segments.push({ words })
    words = []
    return true
  }
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]
    if (quote) {
      if (ch === quote) {
        quote = null
      } else if (quote === '"' && (ch === '$' || ch === '`' || ch === '\\')) {
        return { unreadable: 'expands text inside quotes' }
      } else {
        word += ch
      }
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      started = true
    } else if (ch === ' ' || ch === '\t') {
      endWord()
    } else if (ch === '|' || ch === ';' || (ch === '&' && command[i + 1] === '&')) {
      if (ch !== ';' && command[i + 1] === ch) {
        i += 1
      }
      if (!endSegment()) {
        return { unreadable: 'an empty part of a chain' }
      }
    } else if (/[$`<>(){}\\&!\n\r*?[\]]/.test(ch)) {
      return { unreadable: `uses "${ch}"` }
    } else if (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) > 0x7e) {
      return { unreadable: 'has characters it cannot read' }
    } else {
      word += ch
      started = true
    }
  }
  if (quote) {
    return { unreadable: 'an unclosed quote' }
  }
  if (!endSegment() && segments.length === 0) {
    return { unreadable: 'no command' }
  }
  return { segments }
}

function programName(word: string): string {
  const at = word.lastIndexOf('/')
  return (at === -1 ? word : word.slice(at + 1)).toLowerCase()
}

/** High-risk words anywhere in the command, read before any parsing so nothing hides them. */
export function scanHighRisk(command: string): ForkApprovalGrade | null {
  const words = command.split(/[^A-Za-z0-9_./~-]+/).filter(Boolean)
  for (let i = 0; i < words.length; i += 1) {
    const name = programName(words[i])
    const next = words[i + 1]?.toLowerCase()
    if (HIGH_PROGRAMS.has(name)) {
      return high(`runs ${name}`)
    }
    const gitWrite =
      name === 'git' ? words.slice(i + 1, i + 5).find((w) => GIT_WRITE.test(w)) : undefined
    if (gitWrite) {
      return high(`git ${gitWrite} changes the repository or reaches a remote`)
    }
    if (
      name === 'gh' &&
      next &&
      !GH_READ.has(words[i + 2]?.toLowerCase() ?? '') &&
      next !== 'help' &&
      next !== '--version'
    ) {
      return high('a GitHub command that is not a view or a list')
    }
    if (name === 'rm' || name === 'rmdir' || name === 'unlink' || name === 'trash') {
      return high('deletes files')
    }
    if (
      SHELLS.has(name) &&
      (next === '-c' || next === '-lc' || next === '-ic' || next === undefined)
    ) {
      return high('runs a nested shell')
    }
    if (
      PACKAGE_MANAGERS.has(name) &&
      next &&
      /^(publish|unpublish|login|logout|adduser|owner|deprecate|dist-tag|token)$/.test(next)
    ) {
      return high(`${name} ${next} acts on a registry account`)
    }
    if (
      PACKAGE_MANAGERS.has(name) &&
      words.slice(i + 1, i + 4).some((w) => w === '-g' || w === '--global')
    ) {
      return high('a global install')
    }
  }
  if (/\b(dangerouslyDisableSandbox)\b/.test(command)) {
    return high('asks to run outside the sandbox')
  }
  if (/\|\s*(sudo\s+)?(sh|bash|zsh|python3?|node|perl|ruby)\b/.test(command)) {
    return high('pipes text into a shell or interpreter')
  }
  return null
}

function gradeGit(args: string[]): ForkApprovalGrade | null {
  const sub = args.find((word) => !word.startsWith('-'))
  if (args[0]?.startsWith('-')) {
    // Global options (-C, -c, --git-dir and the like) can move or reconfigure git.
    return medium('git with global options')
  }
  if (sub === 'branch') {
    return args.slice(1).every((flag) => GIT_BRANCH_READ_FLAGS.has(flag))
      ? null
      : medium('git branch with names or flags that change branches')
  }
  if (sub === 'remote') {
    return args.slice(1).every((flag) => flag === '-v' || flag === '--verbose')
      ? null
      : medium('git remote that is not a listing')
  }
  if (sub === undefined || !GIT_READ.has(sub)) {
    return medium(`git ${sub ?? ''} is not a read`.trim())
  }
  return null
}

/** Grade one plain command (no expansion) run from `base` for an agent working in `root`. */
function gradeSegment(
  words: string[],
  base: string | null,
  root: string | null
): ForkApprovalGrade | null {
  const name = programName(words[0])
  if (
    words[0].includes('/') &&
    !/^\/(usr\/)?(local\/)?s?bin\/|^\/opt\/homebrew\/bin\//.test(words[0])
  ) {
    return medium(`runs ${words[0]}, a program named by its path`)
  }
  if (NETWORK.test(name)) {
    return words.some((w) => UPLOAD_FLAG.test(w))
      ? high(`${name} sends data`)
      : medium(`${name} reaches the network`)
  }
  if (INTERPRETERS.has(name) || PACKAGE_MANAGERS.has(name) || name === 'make') {
    return medium(`${name} runs code`)
  }
  if (!SAFE_READERS.has(name)) {
    return medium(`${name} is not a known read`)
  }
  const args = words.slice(1)
  const unsafe = UNSAFE_FLAGS[name]
  if (unsafe && args.some((w) => unsafe.test(w.split('=')[0]))) {
    return medium(`${name} with a flag that writes or runs a program`)
  }
  if (name === 'git') {
    const git = gradeGit(args)
    if (git) {
      return git
    }
  }
  if (TEXT_ONLY.has(name)) {
    return null
  }
  let patternTaken = !PATTERN_FIRST.has(name)
  const positional = name === 'git' ? args.slice(1) : args
  if (name === 'uniq' && positional.filter((w) => !w.startsWith('-')).length > 1) {
    return medium('uniq with an output file')
  }
  for (const word of positional) {
    if (word.startsWith('-')) {
      continue
    }
    if (!patternTaken) {
      patternTaken = true
      continue
    }
    const place = placePath(word, base, root)
    if (place === 'sensitive') {
      return high(`reads ${word}, a credential or configuration file`)
    }
    if (place === 'outside') {
      return medium(`reads ${word}, outside the workspace`)
    }
  }
  return null
}

const RANK: Record<ForkApprovalRisk, number> = { low: 0, medium: 1, high: 2 }

export function worseGrade(a: ForkApprovalGrade, b: ForkApprovalGrade): ForkApprovalGrade {
  return RANK[b.risk] > RANK[a.risk] ? b : a
}

/** The grade of a whole command line run in `root` (the agent's folder; null when unknown). */
export function gradeShellCommand(command: string, root: string | null): ForkApprovalGrade {
  const trimmed = command.trim()
  if (trimmed.length > MAX_COMMAND_LENGTH) {
    return high('too long to read whole')
  }
  const highRisk = scanHighRisk(trimmed)
  if (highRisk) {
    return highRisk
  }
  const split = splitShellCommand(trimmed)
  if ('unreadable' in split) {
    return medium(`the command ${split.unreadable}`)
  }
  let base = root
  for (const { words } of split.segments) {
    if (programName(words[0]) === 'cd') {
      const target = words[1] === undefined ? null : resolvePath(words[1], base)
      if (words.length !== 2 || target === null || !isInside(target, root)) {
        return medium('moves outside the workspace')
      }
      base = target
      continue
    }
    const grade = gradeSegment(words, base, root)
    if (grade) {
      return grade
    }
  }
  return { risk: 'low', reason: 'reads inside the workspace' }
}
