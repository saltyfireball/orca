// SLRM-2265: rewrite the source host's paths in a chat transcript to the target's, so a resumed
// chat on the target works in its new folder. Transcripts are JSON lines, so a path appears both
// as written and JSON-escaped (Windows backslashes double); both forms are rewritten.

export type TranscriptPathRewrite = { from: string; to: string }

/** Characters that continue a path name: `/repo` must not match inside `/repo-two`. */
const NAME_CHAR = '[A-Za-z0-9_.\\-]'
/** After a match: no name character, though a sentence's closing period is fine (`/repo.`). */
const NAME_CONTINUES = '[A-Za-z0-9_\\-]|\\.[A-Za-z0-9_.\\-]'

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function jsonEscaped(text: string): string {
  return JSON.stringify(text).slice(1, -1)
}

function trimTrailingSeparators(path: string): string {
  return path.length > 1 ? path.replace(/[\\/]+$/, '') : path
}

/** Every spelling of each rewrite, longest first so a worktree path wins over its home. */
function spellings(rewrites: readonly TranscriptPathRewrite[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const rewrite of rewrites) {
    const from = trimTrailingSeparators(rewrite.from)
    const to = trimTrailingSeparators(rewrite.to)
    if (!from || from === to || from === '/' || from.length < 2) {
      continue
    }
    for (const [f, t] of [
      [from, to],
      [jsonEscaped(from), jsonEscaped(to)]
    ]) {
      if (!map.has(f)) {
        map.set(f, t)
      }
    }
  }
  return new Map([...map.entries()].sort((a, b) => b[0].length - a[0].length))
}

/** A rewriter over the given paths; one pass, so a rewritten path is never rewritten again. */
export function createTranscriptPathRewriter(
  rewrites: readonly TranscriptPathRewrite[]
): (text: string) => string {
  const map = spellings(rewrites)
  if (map.size === 0) {
    return (text) => text
  }
  const alternatives = [...map.keys()].map(escapeRegExp).join('|')
  const pattern = new RegExp(`(?<!${NAME_CHAR})(?:${alternatives})(?!${NAME_CONTINUES})`, 'g')
  return (text) => text.replace(pattern, (match) => map.get(match) ?? match)
}

/** The rewrites of a move: the worktree folder, and the home folder when that setting is on. */
export function worktreeMoveRewrites(args: {
  sourcePath: string
  targetPath: string
  sourceHome: string
  targetHome: string
  rewriteHome: boolean
}): TranscriptPathRewrite[] {
  const rewrites = [{ from: args.sourcePath, to: args.targetPath }]
  if (args.rewriteHome) {
    rewrites.push({ from: args.sourceHome, to: args.targetHome })
  }
  return rewrites
}
