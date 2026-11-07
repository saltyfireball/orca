// Fork release versions: upstream M.m.p plus fork release N becomes M.m.(p*1000+N), N in 1..999.
// Upstream 1.4.252 fork release 1 is 1.4.252001 (tag v1.4.252001), so every fork release on a newer
// upstream base sorts above every fork release on an older one, and stays a plain semver release.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MAX_FORK_RELEASES_PER_BASE = 999
const UPSTREAM_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/

function parseUpstreamVersion(upstreamVersion) {
  const match = UPSTREAM_VERSION_RE.exec(upstreamVersion)
  if (!match) {
    throw new Error(`Upstream version must be plain M.m.p, got ${JSON.stringify(upstreamVersion)}`)
  }
  const [major, minor, patch] = match.slice(1).map(Number)
  const firstPatch = patch * 1000 + 1
  if (!Number.isSafeInteger(firstPatch + MAX_FORK_RELEASES_PER_BASE)) {
    throw new Error(`Upstream patch ${patch} is too large for a fork version`)
  }
  return { major, minor, patch }
}

/** The fork release number N an existing tag or version holds for this upstream base, or null. */
export function forkReleaseNumber(upstreamVersion, existing) {
  const { major, minor, patch } = parseUpstreamVersion(upstreamVersion)
  const match = UPSTREAM_VERSION_RE.exec(String(existing).trim().replace(/^v/, ''))
  if (!match || Number(match[1]) !== major || Number(match[2]) !== minor) {
    return null
  }
  const n = Number(match[3]) - patch * 1000
  return n >= 1 && n <= MAX_FORK_RELEASES_PER_BASE ? n : null
}

/** The next fork version for `upstreamVersion`, given every existing fork tag or version. */
export function nextForkVersion(upstreamVersion, existing) {
  const { major, minor, patch } = parseUpstreamVersion(upstreamVersion)
  const used = existing
    .map((entry) => forkReleaseNumber(upstreamVersion, entry))
    .filter((n) => n !== null)
  const next = used.length === 0 ? 1 : Math.max(...used) + 1
  if (next > MAX_FORK_RELEASES_PER_BASE) {
    throw new Error(
      `Fork release overflow: upstream ${upstreamVersion} already has ${MAX_FORK_RELEASES_PER_BASE} fork releases`
    )
  }
  return `${major}.${minor}.${patch * 1000 + next}`
}

// CLI: node config/scripts/fork/fork-version.mjs <upstream-version>, existing tags one per line on stdin.
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const upstreamVersion = process.argv[2]
  const existing = readFileSync(0, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  process.stdout.write(`${nextForkVersion(upstreamVersion, existing)}\n`)
}
