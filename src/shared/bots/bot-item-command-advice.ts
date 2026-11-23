// A tip back to an agent whose Needs you comment holds commands for the owner as prose: numbered
// "(1) ... (2) ..." runs with pipes or known command words, or a line that opens with a shell prompt.
// Advice only (the comment is already posted). Code the agent already fenced is skipped, since the owner
// can copy that. Bounded: one pass over a prefix.
const SCAN_LIMIT = 8_000

const COMMAND_WORDS =
  /\b(?:sudo|brew|npm|npx|pnpm|yarn|pip|uv|git|gh|ssh|scp|rsync|curl|wget|docker|kubectl|systemctl|launchctl|pm2|chmod|chown|export|apt(?:-get)?|orca|secret(?:-setup)?|tr -d|cat|echo)\s+[\w./~$-]/
const NUMBERED = /(?:^|[\s(:;,])\(?(\d{1,2})[).]\s+\S/g
const PROMPT_LINE = /^\s*(?:[$!]|>\s*\$)\s+\S/m

/** The text a reader sees as prose: closed fenced blocks and inline code removed. */
function withoutFencedCode(text: string): string {
  return text
    .slice(0, SCAN_LIMIT)
    .replace(/(`{3,})[\s\S]*?\1/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
}

/** Whether the comment looks like it hands the owner commands outside steps or a fenced block. */
export function botItemCommentHoldsCommands(comment: string): boolean {
  const prose = withoutFencedCode(comment)
  if (PROMPT_LINE.test(prose)) {
    return true
  }
  const numbers = new Set([...prose.matchAll(NUMBERED)].map((match) => match[1]))
  const sequential = numbers.has('1') && numbers.has('2')
  // Pipes and redirects count only beside a command word, so "A | B" in prose is not enough.
  return (
    sequential && (COMMAND_WORDS.test(prose) || (/\s\|\s/.test(prose) && /\s[<>]\s/.test(prose)))
  )
}

/** Whether text reads as a shell command line (a prompt, a known command word, or pipes and redirects
 *  around words): such text in a code span or block is never turned into file links, so selecting it
 *  and copying it stays whole. A lone path or a word is not a command. */
export function looksLikeShellCommand(text: string): boolean {
  const first = text.trim().split('\n', 1)[0] ?? ''
  if (!/\s/.test(first)) {
    return false
  }
  return (
    /^(?:[$!]|>\s*\$)\s+\S/.test(first) ||
    COMMAND_WORDS.test(first) ||
    /\s(?:\||&&|\|\||[<>]{1,2})\s/.test(first)
  )
}

export const BOT_ITEM_COMMAND_TIP =
  'Posted. Tip: Commands for your owner go in steps, one command per step with its computer named: write them to a file and set Needs you again with --steps-file <file> (or put each in its own fenced sh block). Do not say below or above about them.'
