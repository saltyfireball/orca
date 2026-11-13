// SLRM-2096: web links for a lost work item's remote, for the create pull request action.

/** `git@host:owner/repo.git`, `ssh://git@host/owner/repo` or `https://host/owner/repo` as https. */
export function remoteWebUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim()
  const scp = /^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?\/?$/.exec(trimmed)
  if (scp) {
    return `https://${scp[1]}/${scp[2]}`
  }
  try {
    const url = new URL(trimmed)
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) {
      return null
    }
    const path = url.pathname.replace(/\.git$/, '').replace(/\/$/, '')
    return path.length > 1 ? `https://${url.hostname}${path}` : null
  } catch {
    return null
  }
}

/** A GitHub compare page that offers to open a pull request for the branch. */
export function pullRequestCompareUrl(web: string, base: string, branch: string): string | null {
  const parsed = new URL(web)
  if (parsed.hostname !== 'github.com') {
    return null
  }
  const enc = (ref: string) => ref.split('/').map(encodeURIComponent).join('/')
  return `${web}/compare/${enc(base)}...${enc(branch)}?expand=1`
}
