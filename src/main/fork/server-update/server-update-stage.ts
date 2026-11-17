// Server updates (FORK.md, SLRM-2310): download a release next to the install, check it, and swap it
// in with the old one kept for a rollback. Every step that can fail runs before the swap, so a bad
// download, checksum, signature or version leaves the running install untouched. Commands (ditto,
// codesign, tar) run through `run` so tests pass a fake; nothing here reaches the network itself.
import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  forkLinuxServerTarball,
  forkReleaseAssetUrl,
  FORK_SERVER_UPDATE_LINUX_SUMS_FILE,
  FORK_SERVER_UPDATE_MAC_BUNDLE_ID,
  FORK_SERVER_UPDATE_MAC_MANIFEST_FILE,
  parseForkMacManifest,
  parseForkSha256Sums
} from '../../../shared/fork/server-update'
import { downloadForkFile, fetchForkText, type ForkFetch } from './server-update-fetch'
import { readLinuxServerVersion, readMacAppIdentity } from './server-update-install'

export type ForkRun = (
  program: string,
  args: string[]
) => Promise<{ code: number | null; out: string }>

export type ForkStageDeps = {
  fetch: ForkFetch
  run: ForkRun
  signal?: AbortSignal
}

/** The folder beside the install that holds downloads, the unpacked release and the old install. */
export function forkUpdateWorkDir(installPath: string): string {
  return join(dirname(installPath), `.${basename(installPath)}.fork-update`)
}

export function forkUpdatePreviousPath(workDir: string): string {
  return join(workDir, 'previous')
}

/**
 * Makes the work folder (0700) or checks the one there is ours: a real folder, not a symlink, owned
 * by this user. The download and unpack folders are emptied; `previous` is left for a rollback.
 */
export async function prepareForkUpdateWorkDir(workDir: string, uid: number | null): Promise<void> {
  await mkdir(workDir, { recursive: true, mode: 0o700 })
  const info = await lstat(workDir)
  if (!info.isDirectory() || info.isSymbolicLink() || (uid !== null && info.uid !== uid)) {
    throw new Error(`${workDir} is not a folder this user owns; remove it and try again`)
  }
  for (const name of ['download', 'unpacked', 'swap']) {
    await rm(join(workDir, name), { recursive: true, force: true })
  }
  await mkdir(join(workDir, 'download'), { mode: 0o700 })
  await mkdir(join(workDir, 'unpacked'), { mode: 0o700 })
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() === true
}

async function mustRun(deps: ForkStageDeps, what: string, program: string, args: string[]) {
  const result = await deps.run(program, args)
  if (result.code !== 0) {
    const detail = result.out.trim().split('\n').slice(-3).join(' ').slice(0, 400)
    throw new Error(`${what} failed${detail ? `: ${detail}` : ''}`)
  }
}

/** Downloads Blackfish's macOS zip for `version`, checks its sha512, signer and version. */
export async function stageForkMacRelease(
  deps: ForkStageDeps,
  input: { releasesUrl: string; requirement: string; version: string; workDir: string }
): Promise<string> {
  const manifestUrl = forkReleaseAssetUrl(
    input.releasesUrl,
    input.version,
    FORK_SERVER_UPDATE_MAC_MANIFEST_FILE
  )
  const manifest = parseForkMacManifest(await fetchForkText(deps.fetch, manifestUrl, deps.signal))
  if (!manifest) {
    throw new Error(`${manifestUrl} names no zip with a sha512`)
  }
  if (manifest.version !== input.version) {
    throw new Error(`${manifestUrl} is for ${manifest.version}, not ${input.version}`)
  }
  const zip = join(input.workDir, 'download', manifest.file)
  const sha512 = await downloadForkFile(
    deps.fetch,
    forkReleaseAssetUrl(input.releasesUrl, input.version, manifest.file),
    zip,
    { algorithm: 'sha512', encoding: 'base64' },
    deps.signal
  )
  if (sha512 !== manifest.sha512) {
    throw new Error(`checksum mismatch for ${manifest.file}`)
  }
  const unpacked = join(input.workDir, 'unpacked')
  await mustRun(deps, `unpacking ${manifest.file}`, '/usr/bin/ditto', ['-x', '-k', zip, unpacked])
  const apps = (await readdir(unpacked)).filter((name) => name.endsWith('.app'))
  if (apps.length !== 1) {
    throw new Error(`${manifest.file} holds ${apps.length} apps, not one`)
  }
  const app = join(unpacked, apps[0])
  await mustRun(
    deps,
    `checking the signature of ${apps[0]} (${input.requirement})`,
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', `-R=${input.requirement}`, app]
  )
  const identity = await readMacAppIdentity(app)
  if (
    identity?.bundleId !== FORK_SERVER_UPDATE_MAC_BUNDLE_ID ||
    identity.version !== input.version
  ) {
    throw new Error(
      `${apps[0]} is ${identity ? `${identity.bundleId} ${identity.version}` : 'unreadable'}, not ${FORK_SERVER_UPDATE_MAC_BUNDLE_ID} ${input.version}`
    )
  }
  await rm(zip, { force: true })
  return app
}

/** Downloads the Linux server tarball for `version`, checks its sha256 and version. */
export async function stageForkLinuxRelease(
  deps: ForkStageDeps,
  input: { releasesUrl: string; version: string; workDir: string; arch: string }
): Promise<string> {
  const file = forkLinuxServerTarball(input.arch)
  if (!file) {
    throw new Error(`no Linux server is published for ${input.arch}`)
  }
  const sumsUrl = forkReleaseAssetUrl(
    input.releasesUrl,
    input.version,
    FORK_SERVER_UPDATE_LINUX_SUMS_FILE
  )
  const want = parseForkSha256Sums(await fetchForkText(deps.fetch, sumsUrl, deps.signal), file)
  if (!want) {
    throw new Error(`${sumsUrl} has no sha256 for ${file}`)
  }
  const tarball = join(input.workDir, 'download', file)
  const got = await downloadForkFile(
    deps.fetch,
    forkReleaseAssetUrl(input.releasesUrl, input.version, file),
    tarball,
    { algorithm: 'sha256', encoding: 'hex' },
    deps.signal
  )
  if (got !== want) {
    throw new Error(`checksum mismatch for ${file}`)
  }
  const server = join(input.workDir, 'unpacked', 'server')
  await mkdir(server, { mode: 0o700 })
  await mustRun(deps, `unpacking ${file}`, 'tar', [
    '-xzf',
    tarball,
    '-C',
    server,
    '--strip-components=1',
    '--no-same-owner'
  ])
  const launcher = join(server, 'bin', 'orca-ide')
  if ((await stat(launcher).catch(() => null))?.isFile() !== true) {
    throw new Error(`${file} has no bin/orca-ide`)
  }
  const version = await readLinuxServerVersion(server)
  if (version !== input.version) {
    throw new Error(`${file} holds ${version ?? 'no version'}, not ${input.version}`)
  }
  await rm(tarball, { force: true })
  return server
}

/** Puts the staged release in place and keeps the running one as `previous` (one is kept). */
export async function swapInForkRelease(
  installPath: string,
  stagedPath: string,
  workDir: string
): Promise<void> {
  const previous = forkUpdatePreviousPath(workDir)
  await rm(previous, { recursive: true, force: true })
  await rename(installPath, previous)
  try {
    await rename(stagedPath, installPath)
  } catch (error) {
    await rename(previous, installPath)
    throw error
  }
}

/** Swaps the install and `previous`, so a rollback can itself be rolled back. */
export async function swapForkPrevious(installPath: string, workDir: string): Promise<void> {
  const previous = forkUpdatePreviousPath(workDir)
  const swap = join(workDir, 'swap')
  if (!(await isDirectory(previous))) {
    throw new Error('no earlier version is kept here')
  }
  await rm(swap, { recursive: true, force: true })
  await rename(installPath, swap)
  try {
    await rename(previous, installPath)
  } catch (error) {
    await rename(swap, installPath)
    throw error
  }
  await rename(swap, previous)
}
