import { flattenTerminalQuickCommand } from '../terminal/quick-commands/terminal-quick-commands'

// Fence languages whose body is a shell command a chat Run button may offer to run.
const RUNNABLE_SHELL_FENCE_LANGUAGES = new Set(['sh', 'bash', 'zsh', 'shell', 'console'])

const CONSOLE_PROMPT = '$ '

// Controls (TAB and LF aside), format, private-use, surrogate, line and paragraph separators,
// default-ignorable characters and every space but U+0020. CR only as part of CRLF.
const UNSAFE_CHARACTER_RE =
  /[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]|[^\P{Cc}\t\n\r]|\r(?!\n)|[^\P{Zs} ]/u

// Words that open or continue a compound command, which the one-line join would break.
const COMPOUND_WORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'case',
  'esac',
  'for',
  'select',
  'while',
  'until',
  'do',
  'done',
  'function',
  '{',
  '}',
  '[[',
  ']]',
  ';;'
])

function normalizeFenceLanguage(lang: string | null | undefined): string {
  return (lang ?? '').trim().toLowerCase()
}

export function isRunnableShellFence(lang: string | null | undefined): boolean {
  return RUNNABLE_SHELL_FENCE_LANGUAGES.has(normalizeFenceLanguage(lang))
}

/** True when the text holds a control, bidi or invisible character a Run button must never send. */
export function hasUnsafeShellCharacters(text: string): boolean {
  return UNSAFE_CHARACTER_RE.test(text)
}

function hasHeredoc(line: string): boolean {
  // `<<<` is a here-string and stays on its line; `<<` and `<<-` read the following lines.
  return /(^|[^<])<<(?!<)/.test(line)
}

function hasOddCount(line: string, quote: string): boolean {
  let count = 0
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '\\') {
      index++
    } else if (line[index] === quote) {
      count++
    }
  }
  return count % 2 === 1
}

function countOf(line: string, char: string): number {
  return line.split(char).length - 1
}

/** True when joining this line with `; ` could change what it means. */
function breaksWhenJoined(line: string): boolean {
  const firstWord = line.split(/\s+/, 1)[0]
  return (
    COMPOUND_WORDS.has(firstWord) ||
    // An inline comment would swallow every later line.
    /(^|\s)#/.test(line) ||
    // A leading or trailing operator continues onto the next line.
    /^(\|\||&&|\||&|;)/.test(line) ||
    /(\|\||&&|\||&|;|\(|\{|\\)$/.test(line) ||
    /(^|\s)(do|then|else|in)$/.test(line) ||
    // Quotes or brackets left open carry a string or subshell onto the next line.
    hasOddCount(line, "'") ||
    hasOddCount(line, '"') ||
    hasOddCount(line, '`') ||
    countOf(line, '(') !== countOf(line, ')') ||
    countOf(line, '{') !== countOf(line, '}')
  )
}

/** Joins backslash-newline continuations the way the shell does, or null inside single quotes. */
function joinContinuations(text: string): string | null {
  const parts = text.split('\\\n')
  for (let index = 0; index < parts.length - 1; index++) {
    // Inside single quotes the shell keeps a backslash-newline as literal text.
    if (hasOddCount(parts.slice(0, index + 1).join(''), "'")) {
      return null
    }
  }
  return parts.join('')
}

/**
 * The exact one-line command a Run button shows and runs, or null when the fence is not a shell
 * fence, carries unsafe characters, or would change meaning when flattened to one line.
 */
export function commandFromShellFence(
  code: string,
  lang: string | null | undefined
): string | null {
  if (!isRunnableShellFence(lang) || hasUnsafeShellCharacters(code)) {
    return null
  }
  const text = code.replace(/\r\n/g, '\n')
  // console fences mix prompts with output: only `$ ` lines are commands.
  const source =
    normalizeFenceLanguage(lang) === 'console'
      ? text
          .split('\n')
          .filter((line) => line.startsWith(CONSOLE_PROMPT))
          .map((line) => line.slice(CONSOLE_PROMPT.length))
          .join('\n')
      : joinContinuations(text)
  if (source === null) {
    return null
  }
  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
  if (lines.length === 0 || lines.some(hasHeredoc) || lines.at(-1)?.endsWith('\\')) {
    return null
  }
  if (lines.length > 1 && lines.some(breaksWhenJoined)) {
    return null
  }
  return flattenTerminalQuickCommand({
    id: 'fork-chat-run',
    label: '',
    command: lines.join('\n'),
    appendEnter: true
  }).command
}
