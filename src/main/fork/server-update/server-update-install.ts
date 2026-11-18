// Server updates (FORK.md, SLRM-2310): which install this server runs from and which service runs
// it. The answer comes from the service unit `orca serve service install` or dotfiles orca-server
// wrote for this profile (same label prefix and unit name), so a server that is not run by
// launchd or systemd, or runs from somewhere else, is never touched. Keep electron out of this file.
import { constants } from 'node:fs'
import { access, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SERVE_LAUNCHD_LABEL_PREFIX } from '../../../shared/remote-runtime/serve-supervisor/serve-bundle-coordination'
import { isSameUserDataPath } from '../../../shared/remote-runtime/serve-supervisor/serve-user-data-path'
import { FORK_SERVER_UPDATE_MAC_BUNDLE_ID } from '../../../shared/fork/server-update'
import type { ForkServerInstallKind } from '../../../shared/fork/server-update-wire'

const SYSTEMD_UNIT_PREFIX = 'orca-serve'

export type ForkServeService = {
  manager: 'launchd' | 'systemd'
  /** launchd label, or systemd unit name with `.service`. */
  name: string
  unitPath: string
}

export type ForkServerInstall = {
  kind: ForkServerInstallKind
  /** The app bundle (macOS) or the unpacked server folder (Linux) the service runs. */
  path: string
  service: ForkServeService
}

type UnitCommand = { name: string; args: string[]; env: Record<string, string> }

function xmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Label, ProgramArguments and EnvironmentVariables of a LaunchAgent plist as Orca writes it. */
export function parseLaunchAgent(text: string): UnitCommand | null {
  const label = /<key>Label<\/key>\s*<string>([^<]*)<\/string>/.exec(text)?.[1]
  const argBlock = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text)?.[1]
  if (!label || argBlock === undefined) {
    return null
  }
  const args = [...argBlock.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => xmlText(m[1]))
  const env: Record<string, string> = {}
  const envBlock = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(text)?.[1]
  for (const m of envBlock?.matchAll(/<key>([^<]*)<\/key>\s*<string>([^<]*)<\/string>/g) ?? []) {
    env[xmlText(m[1])] = xmlText(m[2])
  }
  return { name: xmlText(label), args, env }
}

/** systemd's word splitting: double or single quotes, backslash escapes, `%%` for `%`. */
export function splitSystemdWords(line: string): string[] {
  const words: string[] = []
  let current = ''
  let inWord = false
  let quote: '"' | "'" | null = null
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '\\' && quote !== "'" && index + 1 < line.length) {
      current += line[(index += 1)]
      inWord = true
    } else if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      quote = char
      inWord = true
    } else if (/\s/.test(char)) {
      if (inWord) {
        words.push(current)
        current = ''
        inWord = false
      }
    } else {
      current += char
      inWord = true
    }
  }
  if (inWord) {
    words.push(current)
  }
  return words.map((word) => word.replace(/%%/g, '%'))
}

/** ExecStart and Environment of a systemd user unit as Orca writes it. */
export function parseSystemdUnit(name: string, text: string): UnitCommand | null {
  let args: string[] | null = null
  const env: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('ExecStart=')) {
      args = splitSystemdWords(line.slice('ExecStart='.length))
    } else if (line.startsWith('Environment=')) {
      for (const word of splitSystemdWords(line.slice('Environment='.length))) {
        const eq = word.indexOf('=')
        if (eq > 0) {
          env[word.slice(0, eq)] = word.slice(eq + 1)
        }
      }
    }
  }
  return args && args.length > 0 ? { name, args, env } : null
}

const MAC_LAUNCHER = /^(\/.+\.app)\/Contents\/Resources\/bin\/orca$/
const LINUX_LAUNCHER = /^(\/.+)\/bin\/orca-ide$/

async function realpathOr(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

/** The install a unit's command line runs: the first argument that is an Orca launcher. */
export async function installOfArgs(
  args: readonly string[],
  platform: NodeJS.Platform
): Promise<{ kind: ForkServerInstallKind; path: string } | null> {
  const pattern = platform === 'darwin' ? MAC_LAUNCHER : LINUX_LAUNCHER
  for (const arg of args) {
    if (!arg.startsWith('/')) {
      continue
    }
    // A symlinked launcher (/usr/local/bin/orca) counts as the install it points into.
    const match = pattern.exec(arg) ?? pattern.exec(await realpathOr(arg))
    if (match) {
      return { kind: platform === 'darwin' ? 'mac-app' : 'linux-server', path: match[1] }
    }
  }
  return null
}

export type ForkInstallLookup = {
  platform: NodeJS.Platform
  homeDir: string
  /** XDG_CONFIG_HOME, when set. */
  configHome?: string
  userDataPath: string
  readDir?: (path: string) => Promise<string[]>
  readFile?: (path: string) => Promise<string>
}

async function units(lookup: ForkInstallLookup): Promise<ForkServeService[]> {
  const readDir = lookup.readDir ?? ((path: string) => readdir(path))
  const list = async (dir: string, match: (file: string) => boolean): Promise<string[]> => {
    try {
      return (await readDir(dir)).filter(match).sort()
    } catch {
      return []
    }
  }
  if (lookup.platform === 'darwin') {
    const dir = join(lookup.homeDir, 'Library', 'LaunchAgents')
    return (
      await list(
        dir,
        (file) => file.startsWith(SERVE_LAUNCHD_LABEL_PREFIX) && file.endsWith('.plist')
      )
    ).map((file) => ({
      manager: 'launchd',
      name: file.slice(0, -'.plist'.length),
      unitPath: join(dir, file)
    }))
  }
  const dir = join(lookup.configHome || join(lookup.homeDir, '.config'), 'systemd', 'user')
  return (
    await list(dir, (file) => file.startsWith(SYSTEMD_UNIT_PREFIX) && file.endsWith('.service'))
  ).map((file) => ({ manager: 'systemd', name: file, unitPath: join(dir, file) }))
}

/** This profile's serve service and the install it runs, or why there is none to update. */
export async function findForkServerInstall(
  lookup: ForkInstallLookup
): Promise<ForkServerInstall | { problem: string }> {
  if (lookup.platform !== 'darwin' && lookup.platform !== 'linux') {
    return { problem: `updates run only on macOS and Linux servers, not ${lookup.platform}` }
  }
  const read = lookup.readFile ?? ((path: string) => readFile(path, 'utf8'))
  for (const service of await units(lookup)) {
    let text: string
    try {
      text = await read(service.unitPath)
    } catch {
      continue
    }
    const command =
      service.manager === 'launchd' ? parseLaunchAgent(text) : parseSystemdUnit(service.name, text)
    const profile = command?.env.ORCA_USER_DATA_PATH
    if (!command || !profile || !isSameUserDataPath(profile, lookup.userDataPath)) {
      continue
    }
    if (service.manager === 'launchd' && command.name !== service.name) {
      continue
    }
    const install = await installOfArgs(command.args, lookup.platform)
    if (!install) {
      return {
        problem: `${service.unitPath} does not run Blackfish's orca launcher (an app in /Applications or an unpacked server's bin/orca-ide)`
      }
    }
    return { ...install, service }
  }
  return {
    problem:
      'no `orca serve` service runs this profile here (install one with `orca serve service install`)'
  }
}

/** CFBundleIdentifier and CFBundleShortVersionString of an app bundle's Info.plist. */
export async function readMacAppIdentity(
  appPath: string
): Promise<{ bundleId: string; version: string } | null> {
  try {
    const plist = await readFile(join(appPath, 'Contents', 'Info.plist'), 'utf8')
    const value = (key: string): string | undefined =>
      new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`).exec(plist)?.[1]?.trim()
    const bundleId = value('CFBundleIdentifier')
    const version = value('CFBundleShortVersionString')
    return bundleId && version ? { bundleId, version } : null
  } catch {
    return null
  }
}

/** The version an unpacked Linux server folder carries (its orcad's package.json). */
export async function readLinuxServerVersion(serverPath: string): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(serverPath, 'orcad', 'out', 'package.json'), 'utf8')
    )
    const version =
      typeof parsed === 'object' && parsed !== null && 'version' in parsed ? parsed.version : null
    return typeof version === 'string' && version.length > 0 ? version : null
  } catch {
    return null
  }
}

/** The version an install of this kind holds on disk, or null when it is not a Blackfish one. */
export async function readInstallVersion(
  kind: ForkServerInstallKind,
  path: string
): Promise<string | null> {
  if (kind === 'mac-app') {
    const identity = await readMacAppIdentity(path)
    return identity?.bundleId === FORK_SERVER_UPDATE_MAC_BUNDLE_ID ? identity.version : null
  }
  try {
    if (!(await stat(join(path, 'bin', 'orca-ide'))).isFile()) {
      return null
    }
  } catch {
    return null
  }
  return readLinuxServerVersion(path)
}

/** True when this user may replace the install: write access to it and to its folder. */
export async function isForkInstallWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK)
    await access(dirname(path), constants.W_OK)
    return true
  } catch {
    return false
  }
}
