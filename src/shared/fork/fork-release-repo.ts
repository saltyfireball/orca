// Fork builds update from the fork's own GitHub releases, never from upstream.
// Keep in sync with FORK_RELEASE_OWNER in config/scripts/fork/electron-builder.fork.config.cjs.
export const FORK_RELEASE_OWNER = 'saltyfireball'
export const FORK_RELEASE_REPO = `${FORK_RELEASE_OWNER}/orca`
export const FORK_RELEASES_URL = `https://github.com/${FORK_RELEASE_REPO}/releases`

/** The only repositories a fork build may list builds from or update from. */
export const FORK_ALLOWED_RELEASE_REPOS: readonly string[] = [FORK_RELEASE_REPO]

/** The fork publishes plain releases only, so it has no rc or dev channels to offer. */
export const FORK_RELEASE_CHANNELS: readonly string[] = ['stable']

const REPO_PATTERN = FORK_RELEASE_REPO.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

export const FORK_RELEASE_TAG_HREF_RE = new RegExp(
  `href="https://github\\.com/${REPO_PATTERN}/releases/tag/([^"]+)"`
)
export const FORK_RELEASE_TAG_PATH_RE = new RegExp(`^/${REPO_PATTERN}/releases/tag/([^/]+)$`)
export const FORK_RELEASE_DOWNLOAD_URL_RE = new RegExp(
  `^https://github\\.com/${REPO_PATTERN}/releases/download/`,
  'i'
)

export function isForkReleaseChannel(channel: string): boolean {
  return FORK_RELEASE_CHANNELS.includes(channel)
}

/** The fork repo for fork channels; any other channel keeps its upstream repo so the allowlist rejects it. */
export function forkReleaseRepoForChannel(channel: string, upstreamRepo: string): string {
  return isForkReleaseChannel(channel) ? FORK_RELEASE_REPO : upstreamRepo
}

export function isForkReleaseRepo(repo: string): boolean {
  return FORK_ALLOWED_RELEASE_REPOS.includes(repo.toLowerCase())
}

/** Returns the repo when allowlisted, so a call site can wrap its lookup in one line. */
export function assertForkReleaseRepo(repo: string): string {
  if (!isForkReleaseRepo(repo)) {
    throw new Error(`Fork builds only use releases from ${FORK_RELEASE_REPO}, not ${repo}`)
  }
  return repo
}

/**
 * True for a fork release download under github.com, or the loopback feed the app serves
 * itself for a local build file the user picked. Anything else is never an update source.
 */
export function isForkUpdateFeedUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1') {
    return parsed.username === '' && parsed.password === ''
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname === 'github.com' &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.pathname.toLowerCase().startsWith(`/${FORK_RELEASE_REPO}/releases/`)
  )
}
