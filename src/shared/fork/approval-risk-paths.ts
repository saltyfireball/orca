// Approval triage (FORK.md, SLRM-2397): where a path an approval names lands, judged against the
// folder the agent works in. Anything this cannot place for certain counts as outside.

/** Names whose contents are credentials, agent or git configuration: never low, whatever the folder. */
const SENSITIVE_SEGMENTS = new Set([
  '.ssh',
  '.gnupg',
  '.aws',
  '.azure',
  '.kube',
  '.docker',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.pgpass',
  '.git-credentials',
  '.claude',
  '.codex',
  '.config',
  'keychains',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  'authorized_keys',
  'known_hosts',
  // Shell and tool startup files run code at the next login or command.
  '.zshrc',
  '.zshenv',
  '.zprofile',
  '.bashrc',
  '.bash_profile',
  '.profile',
  '.gitconfig',
  'launchagents',
  'launchdaemons',
  // Files that run code in the workspace on their own: direnv, git hook managers, editor tasks.
  '.envrc',
  '.husky',
  '.githooks',
  '.vscode'
])

const SENSITIVE_NAME =
  /^(\.env(\..*)?|.*\.(pem|key|p12|pfx|keychain-db)|credentials(\.json)?|secrets?(\..*)?)$/i

/** `.git/config` and `.git/hooks` run code or redirect pushes; the rest of `.git` is git's own state. */
function sensitiveGitPath(segments: readonly string[]): boolean {
  const at = segments.indexOf('.git')
  if (at === -1) {
    return false
  }
  const next = segments[at + 1]
  return next === undefined || next === 'config' || next === 'hooks' || next === 'info'
}

export function isSensitivePath(path: string): boolean {
  // Lowercase: the default macOS disk ignores case, so `.GIT/hooks` is the hooks folder.
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.toLowerCase())
  if (sensitiveGitPath(segments)) {
    return true
  }
  const github = segments.indexOf('.github')
  if (github !== -1 && segments[github + 1] === 'workflows') {
    return true
  }
  return segments.some((segment) => SENSITIVE_SEGMENTS.has(segment) || SENSITIVE_NAME.test(segment))
}

/** Resolve `.` and `..` lexically; null when `..` climbs past the root. */
export function normalizeAbsolute(path: string): string | null {
  const out: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      if (out.length === 0) {
        return null
      }
      out.pop()
      continue
    }
    out.push(segment)
  }
  return `/${out.join('/')}`
}

/** The folder a path names, from the folder it is read in; null when it cannot be placed. */
export function resolvePath(path: string, base: string | null): string | null {
  if (path === '' || path.startsWith('~') || path.includes('\0')) {
    return null
  }
  if (path.startsWith('/')) {
    return normalizeAbsolute(path)
  }
  return base === null ? null : normalizeAbsolute(`${base}/${path}`)
}

export function isInside(path: string, root: string | null): boolean {
  if (root === null) {
    return false
  }
  const normalizedRoot = normalizeAbsolute(root)
  if (normalizedRoot === null || normalizedRoot === '/') {
    return false
  }
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`)
}

export type PathPlace = 'inside' | 'outside' | 'sensitive'

/** Where a path lands: in the agent's folder, outside it (or unknown), or on a sensitive name. */
export function placePath(path: string, base: string | null, root: string | null): PathPlace {
  if (isSensitivePath(path)) {
    return 'sensitive'
  }
  const resolved = resolvePath(path, base)
  if (resolved === null) {
    return 'outside'
  }
  if (isSensitivePath(resolved)) {
    return 'sensitive'
  }
  return isInside(resolved, root) ? 'inside' : 'outside'
}
