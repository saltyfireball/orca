// BAD-691 (FORK.md "Worktree reclaim"): which git-ignored paths of a worktree count as regenerable.
// A pattern with no slash matches any one path segment ("node_modules" anywhere); a pattern with a
// slash is anchored at the worktree root and may use `**` for any number of segments. `*` and `?`
// stay inside one segment. No node or electron imports: the CLI, main and orca.yaml all read this.

/** Paths a worktree can rebuild: dependencies, build output and caches. */
export const FORK_WORKTREE_RECLAIM_DEFAULT_PATHS: readonly string[] = [
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  '.cache',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '__pycache__',
  '.venv',
  'target',
  '.gradle',
  'coverage'
]

const MAX_RECLAIM_PATTERNS = 64
const MAX_RECLAIM_PATTERN_LENGTH = 200

/**
 * Cleans a list of patterns from settings or orca.yaml. Drops anything that is not a relative path
 * inside the worktree, anything that names `.git`, and a pattern made only of wildcards (it would
 * match every ignored path).
 */
export function normalizeReclaimGlobs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<string>()
  for (const entry of value.slice(0, MAX_RECLAIM_PATTERNS)) {
    if (typeof entry !== 'string') {
      continue
    }
    const normalized = entry.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
    const segments = normalized.split('/')
    if (
      !normalized ||
      normalized.length > MAX_RECLAIM_PATTERN_LENGTH ||
      normalized.startsWith('/') ||
      /^[a-zA-Z]:/.test(normalized) ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
      segments.includes('.git') ||
      segments.every((segment) => /^[*?]+$/.test(segment))
    ) {
      continue
    }
    seen.add(normalized)
  }
  return Array.from(seen)
}

function segmentMatcher(segment: string): RegExp {
  const body = segment
    .split('')
    .map((char) =>
      char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[$()+.[\\\]^{|}]/g, '\\$&')
    )
    .join('')
  return new RegExp(`^${body}$`)
}

type CompiledPattern = { anchored: boolean; segments: (RegExp | '**')[] }

function compilePattern(pattern: string): CompiledPattern {
  return {
    anchored: pattern.includes('/'),
    segments: pattern
      .split('/')
      .map((segment) => (segment === '**' ? '**' : segmentMatcher(segment)))
  }
}

function matchesFrom(
  pattern: readonly (RegExp | '**')[],
  p: number,
  path: readonly string[],
  s: number
): boolean {
  if (p === pattern.length) {
    return true
  }
  const part = pattern[p]
  if (part === '**') {
    for (let skip = s; skip <= path.length; skip += 1) {
      if (matchesFrom(pattern, p + 1, path, skip)) {
        return true
      }
    }
    return false
  }
  return s < path.length && part.test(path[s]) && matchesFrom(pattern, p + 1, path, s + 1)
}

/**
 * A matcher over worktree-relative POSIX paths. A path matches when the pattern names it or one of
 * its parent folders, so an ignored file inside a `node_modules` folder counts.
 */
export function compileReclaimMatcher(globs: readonly string[]): (relativePath: string) => boolean {
  const compiled = normalizeReclaimGlobs([...globs]).map(compilePattern)
  return (relativePath) => {
    const path = relativePath.replace(/\/+$/, '').split('/')
    if (path.length === 0 || path[0] === '') {
      return false
    }
    return compiled.some((pattern) => {
      if (pattern.anchored) {
        return matchesFrom(pattern.segments, 0, path, 0)
      }
      const [matcher] = pattern.segments
      return matcher !== '**' && path.some((segment) => matcher.test(segment))
    })
  }
}

/** Env files and anything starting `.env` are never reclaimed, even inside a matching folder. */
export function isProtectedReclaimName(name: string): boolean {
  return name.startsWith('.env')
}
