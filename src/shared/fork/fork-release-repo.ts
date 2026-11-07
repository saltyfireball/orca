// Fork builds update from the fork's own GitHub releases, never from upstream.
// Keep in sync with FORK_RELEASE_OWNER in config/electron-builder.config.cjs.
export const FORK_RELEASE_OWNER = 'saltyfireball'
export const FORK_RELEASE_REPO = `${FORK_RELEASE_OWNER}/orca`
export const FORK_RELEASES_URL = `https://github.com/${FORK_RELEASE_REPO}/releases`

const REPO_PATTERN = FORK_RELEASE_REPO.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

export const FORK_RELEASE_TAG_HREF_RE = new RegExp(
  `href="https://github\\.com/${REPO_PATTERN}/releases/tag/([^"]+)"`
)
export const FORK_RELEASE_TAG_PATH_RE = new RegExp(`^/${REPO_PATTERN}/releases/tag/([^/]+)$`)
export const FORK_RELEASE_DOWNLOAD_URL_RE = new RegExp(
  `^https://github\\.com/${REPO_PATTERN}/releases/download/`,
  'i'
)
