// Set up on a server (FORK.md, SLRM-2312): when new work is headed for a paired server that lacks
// the project, clone the project there from its git remote, register it, then check the server
// has the tools the project needs. Pure: settings, URL checks and the readiness summary. The
// server answers fork.serverSetup.* (main/fork/server-setup), the desktop picker and the CLI ask.
import type { Project } from '../project/project-types'
import type { Repo } from '../repository/repo-types'
import { stripCredentialsFromMessage } from '../git/remotes/git-remote-error'

export type ForkServerSetupSettings = {
  /** Set up on a server: the new-workspace host picker (and the phone's run-target list, SLRM-2406)
   *  offers "Set up on SERVER..." for a paired server that lacks the project; unset is on. */
  forkServerSetupOffer?: boolean
  /** Set up on a server: folder on the server the project is cloned into, as NAME under it. `~`
   *  is that server's home; unset is ~/development. */
  forkServerSetupParent?: string
  /** Set up on a server: after the clone, list the tools and direnv functions the project needs
   *  that the server lacks; unset is on. */
  forkServerSetupReadiness?: boolean
}

export const FORK_SERVER_SETUP_DEFAULT_PARENT = '~/development'

/** Longest clone URL or parent folder accepted. */
export const FORK_SERVER_SETUP_MAX_TEXT = 2048

type SettingsSource = ForkServerSetupSettings | null | undefined

export function forkServerSetupOffered(settings: SettingsSource): boolean {
  return settings?.forkServerSetupOffer !== false
}

export function forkServerSetupReadinessOn(settings: SettingsSource): boolean {
  return settings?.forkServerSetupReadiness !== false
}

export function forkServerSetupParent(settings: SettingsSource): string {
  const value = settings?.forkServerSetupParent?.trim()
  return value ? value : FORK_SERVER_SETUP_DEFAULT_PARENT
}

/** The same settings, from a settings object read over RPC (a phone reading its host's; SLRM-2406). */
export function readForkServerSetupSettingsFrom(value: unknown): ForkServerSetupSettings {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const offer = 'forkServerSetupOffer' in value ? value.forkServerSetupOffer : undefined
  const parent = 'forkServerSetupParent' in value ? value.forkServerSetupParent : undefined
  const readiness = 'forkServerSetupReadiness' in value ? value.forkServerSetupReadiness : undefined
  return {
    ...(typeof offer === 'boolean' ? { forkServerSetupOffer: offer } : {}),
    ...(typeof parent === 'string' ? { forkServerSetupParent: parent } : {}),
    ...(typeof readiness === 'boolean' ? { forkServerSetupReadiness: readiness } : {})
  }
}

/** Control characters (and, with `spaces`, whitespace): never part of a URL or folder name. */
function hasUnsafeText(text: string, spaces: boolean): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code < 0x20 || code === 0x7f || (spaces && /\s/.test(text[index] ?? ''))) {
      return true
    }
  }
  return false
}
const SCHEMES = new Set(['https', 'http', 'ssh', 'git', 'git+ssh', 'ssh+git'])
const SCHEME_URL = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//
/** `<transport>::<address>` runs a git remote helper (`ext::` runs a command): never accepted. */
const REMOTE_HELPER = /^[A-Za-z][A-Za-z0-9+.-]*::/
/** scp-like `[user@]host:path`, which git reads only when no slash comes before the colon. */
const SCP_LIKE = /^(?:([A-Za-z0-9._~-]+)@)?([A-Za-z0-9.-]+):([^/].*|\/.+)$/
const HOST_NAME = /^[A-Za-z0-9.-]+$/

export type ForkCloneUrlCheck = { ok: true; url: string } | { ok: false; reason: string }

function refuse(reason: string): ForkCloneUrlCheck {
  return { ok: false, reason }
}

/**
 * Whether `raw` is a network git remote a server may clone: https, http, ssh, git or scp-like
 * `user@host:path`. Local paths, file://, remote helpers (`ext::`), embedded passwords, option-like
 * values and control characters are refused, so nothing typed here can reach git as an option or
 * read the server's own disk.
 */
export function checkForkCloneUrl(raw: string): ForkCloneUrlCheck {
  const url = raw.trim()
  if (!url) {
    return refuse('The project has no git remote to clone from.')
  }
  if (url.length > FORK_SERVER_SETUP_MAX_TEXT || hasUnsafeText(url, true)) {
    return refuse('The clone URL has spaces or control characters.')
  }
  if (url.startsWith('-')) {
    return refuse('The clone URL starts with a dash.')
  }
  if (REMOTE_HELPER.test(url)) {
    return refuse('Clone URLs that name a git remote helper (such as ext::) are not accepted.')
  }
  const scheme = SCHEME_URL.exec(url)?.[1]?.toLowerCase()
  if (scheme) {
    if (!SCHEMES.has(scheme)) {
      return refuse(`Only https, http, ssh and git remotes can be cloned, not ${scheme}.`)
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return refuse('The clone URL is not a valid URL.')
    }
    if (!parsed.hostname || parsed.hostname.startsWith('-') || parsed.pathname.length <= 1) {
      return refuse('The clone URL needs a host and a repository path.')
    }
    if (parsed.password) {
      return refuse('The clone URL carries a password; the server uses its own git credentials.')
    }
    return { ok: true, url }
  }
  const scp = SCP_LIKE.exec(url)
  const host = scp?.[2]
  const path = scp?.[3]
  // One letter before the colon is a Windows drive, which git reads as a local path.
  if (!scp || !host || !path || host.length < 2 || !HOST_NAME.test(host)) {
    return refuse('The clone URL is a local path; only network git remotes can be cloned.')
  }
  if (host.startsWith('-') || path.startsWith('-')) {
    return refuse('The clone URL has a part that starts with a dash.')
  }
  return { ok: true, url }
}

/** The parent folder setting, refused when it could not be a plain folder on the server. */
export function checkForkSetupParent(raw: string): string | null {
  const parent = raw.trim()
  if (!parent || parent.length > FORK_SERVER_SETUP_MAX_TEXT || hasUnsafeText(parent, false)) {
    return null
  }
  // `~user` would name another account's home: only `~` and `~/...` mean the server's own.
  if (parent.startsWith('~') && parent !== '~' && !parent.startsWith('~/')) {
    return null
  }
  return parent
}

/** The git remote of the first source checkout of a project that has one (else the project's
 *  own), credentials removed. */
export function forkProjectCloneUrl(
  project: Pick<Project, 'sourceRepoIds' | 'gitRemoteIdentity'> | undefined,
  repos: readonly Pick<Repo, 'id' | 'gitRemoteIdentity'>[]
): string {
  for (const sourceId of project?.sourceRepoIds ?? []) {
    const remoteUrl = repos.find((repo) => repo.id === sourceId)?.gitRemoteIdentity?.remoteUrl
    if (remoteUrl) {
      return stripCredentialsFromMessage(remoteUrl)
    }
  }
  const own = project?.gitRemoteIdentity?.remoteUrl
  return own ? stripCredentialsFromMessage(own) : ''
}

/** The first git remote among a project's checkouts, credentials removed (the phone, which sees
 *  repos rather than projects; SLRM-2406). */
export function forkCloneUrlFromRepos(repos: readonly Pick<Repo, 'gitRemoteIdentity'>[]): string {
  const remoteUrl = repos.find((repo) => repo.gitRemoteIdentity?.remoteUrl)?.gitRemoteIdentity
    ?.remoteUrl
  return remoteUrl ? stripCredentialsFromMessage(remoteUrl) : ''
}

/** What the server lacks for the project, as plain lines. */
export type ForkServerSetupReadiness = {
  /** Tools and direnv functions the project needs that the server lacks. */
  missing: string[]
  /** Facts worth knowing that are not failures (direnv `use` lines and the folders they name). */
  notes: string[]
}

/** direnv's own `use_*` functions; any other `use NAME` needs a function from the user's direnvrc. */
const DIRENV_STDLIB_USE = new Set([
  'flake',
  'guix',
  'julia',
  'nix',
  'node',
  'nodenv',
  'rbenv',
  'vim'
])

export type ForkEnvrcUse = { name: string; args: string }

/** Longest .envrc line read; longer ones are skipped, never matched. */
const ENVRC_MAX_LINE = 1000

/** `use NAME ARGS` lines of an .envrc, comments and blank lines skipped. Linear: no regex runs
 *  over the free text of a line (a repo's .envrc is untrusted). */
export function parseForkEnvrcUses(text: string): ForkEnvrcUse[] {
  const uses: ForkEnvrcUse[] = []
  for (const raw of text.split(/\r\n|[\r\n\u2028\u2029]/)) {
    if (uses.length >= 32) {
      break
    }
    if (raw.length > ENVRC_MAX_LINE) {
      continue
    }
    const hash = raw.indexOf('#')
    const words = (hash === -1 ? raw : raw.slice(0, hash)).trim().split(/[ \t]+/)
    const name = words[1]
    if (words[0] === 'use' && name && /^[A-Za-z0-9_-]+$/.test(name)) {
      uses.push({ name, args: words.slice(2).join(' ').slice(0, 200) })
    }
  }
  return uses
}

/** Whether direnv rc text defines `use_NAME`. */
export function forkDirenvDefinesUse(rcText: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
  return new RegExp(
    `^[ \\t]*(?:function[ \\t]+use_${escaped}\\b|use_${escaped}\\s*\\(\\s*\\))`,
    'm'
  ).test(rcText)
}

/** The direnv part of readiness: direnv itself, and each non-stdlib `use` function. */
export function forkEnvrcReadiness(args: {
  envrc: string | null
  direnvFound: boolean
  direnvRc: string
}): ForkServerSetupReadiness {
  if (args.envrc === null) {
    return { missing: [], notes: [] }
  }
  const missing: string[] = []
  const notes: string[] = []
  if (!args.direnvFound) {
    missing.push('direnv (the project has an .envrc)')
  }
  for (const use of parseForkEnvrcUses(args.envrc)) {
    const line = `use ${use.name}${use.args ? ` ${use.args}` : ''}`
    if (!DIRENV_STDLIB_USE.has(use.name) && !forkDirenvDefinesUse(args.direnvRc, use.name)) {
      missing.push(`direnv function use_${use.name} (for "${line}" in .envrc)`)
    } else {
      notes.push(`.envrc runs "${line}"`)
    }
  }
  return { missing, notes }
}

/** One short line for a toast or the CLI: what is missing, or that nothing is. */
export function describeForkServerSetupReadiness(readiness: ForkServerSetupReadiness): string {
  return readiness.missing.length === 0
    ? 'Nothing the project needs is missing.'
    : `Missing: ${readiness.missing.join('; ')}`
}
