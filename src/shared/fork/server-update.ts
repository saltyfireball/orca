// Server updates (FORK.md, SLRM-2310): the settings, version rules and release manifest parsers
// shared by a paired server (which downloads, checks and installs a release) and the desktop that
// asks it to. No node imports: this file is also bundled into the renderer.

/** The fork's own releases. Each version's files are under `<base>/download/v<version>/`. */
export const FORK_SERVER_UPDATE_DEFAULT_RELEASES_URL =
  'https://github.com/saltyfireball/orca/releases'
/** SHA-1 of the self-signed certificate Blackfish builds are signed with (FORK.md, SLRM-1357). */
export const FORK_SERVER_UPDATE_DEFAULT_MAC_CERT_SHA1 = 'c5e8485cb550edea627fda93ead7cf1975ed3710'
export const FORK_SERVER_UPDATE_MAC_BUNDLE_ID = 'com.saltyfireball.orca'
export const FORK_SERVER_UPDATE_DEFAULT_TURN_WAIT_MINUTES = 30
export const FORK_SERVER_UPDATE_DEFAULT_READY_SECONDS = 180
export const FORK_SERVER_UPDATE_MAX_TURN_WAIT_MINUTES = 24 * 60
export const FORK_SERVER_UPDATE_LINUX_SUMS_FILE = 'orca-server-sha256sums.txt'
export const FORK_SERVER_UPDATE_MAC_MANIFEST_FILE = 'latest-mac.yml'

export type ForkServerUpdateSettings = {
  /** Fork server updates: this host takes update and rollback requests from paired desktops (host-admin); unset is on. */
  forkServerUpdateAccept?: boolean
  /** Fork server updates: where this host downloads releases from (https); unset is the fork's GitHub releases. Set it in the Settings file. */
  forkServerUpdateReleasesUrl?: string
  /** Fork server updates: SHA-1 of the certificate a macOS app must be signed with before it is installed; unset is the fork's. Set it in the Settings file. */
  forkServerUpdateMacCertSha1?: string
  /** Fork server updates: an Apple Team ID the macOS app must be signed by instead of the certificate pin; unset is none. Set it in the Settings file. */
  forkServerUpdateMacTeamId?: string
  /** Fork server updates: minutes a server waits for its running turns to finish before it gives up; unset is 30. */
  forkServerUpdateTurnWaitMinutes?: number
  /** Fork server updates: seconds a restarted server has to come up before the old version is put back; unset is 180. */
  forkServerUpdateReadySeconds?: number
  /** Fork server updates: put the old version back when the new one does not come up; unset is on. */
  forkServerUpdateAutoRollback?: boolean
  /** Fork server updates: when this desktop starts on a new version, update every paired server to it. Off unless true. */
  forkServerUpdateAuto?: boolean
}

export type ForkServerUpdateConfig = {
  accept: boolean
  releasesUrl: string
  macRequirement: string
  turnWaitMinutes: number
  readySeconds: number
  autoRollback: boolean
  auto: boolean
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** An https address, or plain http on loopback (a local build feed); no credentials, query or fragment. */
export function normalizeForkReleasesUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null
  }
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
  if (!secure || url.username || url.password || url.search || url.hash) {
    return null
  }
  return url.toString().replace(/\/+$/, '')
}

/** The codesign requirement a downloaded app must meet: a Team ID when set, else the certificate pin. */
export function forkMacCodeRequirement(
  settings: Pick<
    ForkServerUpdateSettings,
    'forkServerUpdateMacCertSha1' | 'forkServerUpdateMacTeamId'
  >
): string | null {
  const team = settings.forkServerUpdateMacTeamId?.trim()
  if (team) {
    return /^[A-Z0-9]{10}$/.test(team)
      ? `identifier "${FORK_SERVER_UPDATE_MAC_BUNDLE_ID}" and anchor apple generic and certificate leaf[subject.OU] = "${team}"`
      : null
  }
  const cert = (
    settings.forkServerUpdateMacCertSha1?.trim() || FORK_SERVER_UPDATE_DEFAULT_MAC_CERT_SHA1
  ).toLowerCase()
  return /^[0-9a-f]{40}$/.test(cert)
    ? `identifier "${FORK_SERVER_UPDATE_MAC_BUNDLE_ID}" and certificate leaf = H"${cert}"`
    : null
}

/** Settings as the update code uses them. A bad URL or pin is an error, never a fallback. */
export function readForkServerUpdateConfig(
  settings: ForkServerUpdateSettings | null | undefined
): ForkServerUpdateConfig | { error: string } {
  const source = settings ?? {}
  const releasesUrl = normalizeForkReleasesUrl(
    source.forkServerUpdateReleasesUrl ?? FORK_SERVER_UPDATE_DEFAULT_RELEASES_URL
  )
  if (!releasesUrl) {
    return { error: 'forkServerUpdateReleasesUrl must be an https address' }
  }
  const macRequirement = forkMacCodeRequirement(source)
  if (!macRequirement) {
    return {
      error:
        'forkServerUpdateMacCertSha1 must be 40 hex digits and forkServerUpdateMacTeamId 10 letters or digits'
    }
  }
  return {
    accept: source.forkServerUpdateAccept !== false,
    releasesUrl,
    macRequirement,
    turnWaitMinutes: clampInt(
      source.forkServerUpdateTurnWaitMinutes,
      FORK_SERVER_UPDATE_DEFAULT_TURN_WAIT_MINUTES,
      0,
      FORK_SERVER_UPDATE_MAX_TURN_WAIT_MINUTES
    ),
    readySeconds: clampInt(
      source.forkServerUpdateReadySeconds,
      FORK_SERVER_UPDATE_DEFAULT_READY_SECONDS,
      30,
      3600
    ),
    autoRollback: source.forkServerUpdateAutoRollback !== false,
    auto: source.forkServerUpdateAuto === true
  }
}

/** A published release version: three numbers and nothing else (local builds carry a suffix). */
export function isForkReleaseVersion(version: string): boolean {
  return /^\d{1,6}\.\d{1,6}\.\d{1,9}$/.test(version)
}

/**
 * Orders two versions by their leading three numbers; a version with a suffix (a local build)
 * sorts below the same numbers without one. Null when either has no leading three numbers.
 */
export function compareForkVersions(left: string, right: string): number | null {
  const parse = (value: string): { parts: number[]; suffix: boolean } | null => {
    const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(value.trim())
    return match
      ? { parts: [Number(match[1]), Number(match[2]), Number(match[3])], suffix: match[4] !== '' }
      : null
  }
  const a = parse(left)
  const b = parse(right)
  if (!a || !b) {
    return null
  }
  for (let index = 0; index < 3; index += 1) {
    const diff = a.parts[index] - b.parts[index]
    if (diff !== 0) {
      return Math.sign(diff)
    }
  }
  return a.suffix === b.suffix ? 0 : a.suffix ? -1 : 1
}

/** The address of one file of one release. */
export function forkReleaseAssetUrl(releasesUrl: string, version: string, file: string): string {
  if (!isForkReleaseVersion(version) || !/^[A-Za-z0-9._-]+$/.test(file)) {
    throw new Error(`not a release file: ${version} ${file}`)
  }
  return `${releasesUrl}/download/v${version}/${file}`
}

export type ForkMacReleaseManifest = { version: string; file: string; sha512: string }

/** The top-level `version`, `path` and `sha512` of an electron-builder latest-mac.yml. */
export function parseForkMacManifest(text: string): ForkMacReleaseManifest | null {
  const top = (key: string): string | null => {
    const match = new RegExp(`^${key}:[ \\t]*['"]?([^'"\\r\\n]+?)['"]?[ \\t]*$`, 'm').exec(text)
    return match?.[1] ?? null
  }
  const version = top('version')
  const file = top('path')
  const sha512 = top('sha512')
  if (!version || !file || !sha512) {
    return null
  }
  if (!/^[A-Za-z0-9._-]+\.zip$/.test(file) || !/^[A-Za-z0-9+/]{86}==$/.test(sha512)) {
    return null
  }
  return { version, file, sha512 }
}

/** The lowercase sha256 a sha256sum manifest gives for `file`, or null. */
export function parseForkSha256Sums(text: string, file: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})[ \t]+\*?(\S+)[ \t]*$/.exec(line)
    if (match && match[2] === file) {
      return match[1].toLowerCase()
    }
  }
  return null
}

/** The Linux server tarball for a Node architecture; null where the fork publishes none. */
export function forkLinuxServerTarball(arch: string): string | null {
  return arch === 'x64' || arch === 'arm64' ? `orca-server-linux-${arch}.tar.gz` : null
}

/** The server update keys of a whole settings object, each only when it has the right type. */
export function pickForkServerUpdateSettings(value: unknown): ForkServerUpdateSettings {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const source: Record<string, unknown> = { ...value }
  const picked: ForkServerUpdateSettings = {}
  const bool = (key: keyof ForkServerUpdateSettings): boolean | undefined =>
    typeof source[key] === 'boolean' ? source[key] : undefined
  const text = (key: keyof ForkServerUpdateSettings): string | undefined =>
    typeof source[key] === 'string' ? source[key] : undefined
  const num = (key: keyof ForkServerUpdateSettings): number | undefined =>
    typeof source[key] === 'number' ? source[key] : undefined
  const entries: [keyof ForkServerUpdateSettings, unknown][] = [
    ['forkServerUpdateAccept', bool('forkServerUpdateAccept')],
    ['forkServerUpdateReleasesUrl', text('forkServerUpdateReleasesUrl')],
    ['forkServerUpdateMacCertSha1', text('forkServerUpdateMacCertSha1')],
    ['forkServerUpdateMacTeamId', text('forkServerUpdateMacTeamId')],
    ['forkServerUpdateTurnWaitMinutes', num('forkServerUpdateTurnWaitMinutes')],
    ['forkServerUpdateReadySeconds', num('forkServerUpdateReadySeconds')],
    ['forkServerUpdateAutoRollback', bool('forkServerUpdateAutoRollback')],
    ['forkServerUpdateAuto', bool('forkServerUpdateAuto')]
  ]
  return Object.assign(
    picked,
    Object.fromEntries(entries.filter(([, entry]) => entry !== undefined))
  )
}
