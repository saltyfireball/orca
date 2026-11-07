import {
  cpSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { hostname } from 'node:os'
import { basename, join } from 'node:path'
import { FORK_DATA_DIR_NAME, FORK_PRE_READY_APP_NAME, FORK_PRODUCT_NAME } from './app-name'

// Shared mode: with the marker file in the fork's own data folder, Blackfish runs on stock Orca's
// data folder and Keychain key, so quitting one and opening the other switches with nothing to copy.
// Electron's single-instance lock and the desktop profile lock live in that folder, so the two can
// never have it open at once. Before a new fork version first opens it, the stock data is
// snapshotted (APFS clones) into the fork's own folder, so a bad release can be rolled back.

export const SHARED_DATA_MARKER = 'use-stock-data'
// Stock Orca's userData folder and pre-ready app name both come from package.json `name`; the
// pre-ready name fixes the Keychain service, "orca Safe Storage".
export const STOCK_DATA_DIR_NAME = 'orca'
export const STOCK_PRE_READY_APP_NAME = 'orca'
export const SNAPSHOTS_DIR_NAME = 'stock-data-snapshots'
export const SNAPSHOT_STATE_FILE = 'stock-data-snapshot.json'
export const SNAPSHOTS_KEPT = 3

// Top-level folders worth keeping: settings, projects and chats. Caches, models and logs are not.
const SNAPSHOT_DIRS = new Set(['profiles', 'claude-profiles', 'plugins-data', 'ai-vault'])
// Chromium's instance lock entries; SingletonLock links to `<host>-<pid>` of the running app.
const SINGLETON_LOCK = 'SingletonLock'
const SKIPPED_FILES = new Set([SINGLETON_LOCK, 'SingletonSocket', 'SingletonCookie'])

type ForkApp = {
  isPackaged: boolean
  getPath(name: 'appData' | 'userData'): string
  setPath(name: 'userData', path: string): void
  setName(name: string): void
  getVersion(): string
}

type Options = { platform?: NodeJS.Platform; now?: Date }

export type SharedDataResult =
  | { mode: 'own' }
  | { mode: 'shared'; stockDir: string; snapshot: string | null }

/**
 * Packaged only: Electron derives userData from productName ("Blackfish"), so point it back at the
 * fork's folder from before the rename. Returns that folder, or null when this is not the fork's.
 */
function pinForkDataDir(forkApp: ForkApp): string | null {
  if (!forkApp.isPackaged) {
    return null
  }
  const userData = forkApp.getPath('userData')
  if (basename(userData) === FORK_PRODUCT_NAME) {
    const pinned = join(forkApp.getPath('appData'), FORK_DATA_DIR_NAME)
    forkApp.setPath('userData', pinned)
    return pinned
  }
  return basename(userData) === FORK_DATA_DIR_NAME ? userData : null
}

/** Where shared mode would run, or null off macOS or when the marker or stock folder is absent. */
function resolveSharedStockData(
  forkApp: ForkApp,
  forkOwnDir: string,
  platform: NodeJS.Platform
): { forkOwnDir: string; stockDir: string } | null {
  if (platform !== 'darwin') {
    return null
  }
  if (!existsSync(join(forkOwnDir, SHARED_DATA_MARKER))) {
    return null
  }
  const stockDir = join(forkApp.getPath('appData'), STOCK_DATA_DIR_NAME)
  if (!existsSync(stockDir)) {
    console.warn(`[fork] ${SHARED_DATA_MARKER} is set but ${stockDir} is missing; using own data`)
    return null
  }
  return { forkOwnDir, stockDir }
}

/** True when an app on this Mac holds the folder's instance lock; its data may be mid-write. */
export function isDataDirInUse(dir: string): boolean {
  let target: string
  try {
    target = readlinkSync(join(dir, SINGLETON_LOCK))
  } catch {
    return false
  }
  const split = target.lastIndexOf('-')
  const pid = Number(target.slice(split + 1))
  if (target.slice(0, split) !== hostname() || !Number.isInteger(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readSnapshotVersion(forkOwnDir: string): string | null {
  try {
    const state = JSON.parse(readFileSync(join(forkOwnDir, SNAPSHOT_STATE_FILE), 'utf8'))
    return typeof state?.version === 'string' ? state.version : null
  } catch {
    return null
  }
}

// Time first, so names sort oldest to newest.
function snapshotName(version: string, now: Date): string {
  return `${now.toISOString().replace(/[:.]/g, '-')}_v${version}`
}

/** Clones the settings, projects and chat data of stock's folder; caches and models stay out. */
export function snapshotStockData(stockDir: string, target: string): void {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(stockDir, { withFileTypes: true })) {
    const keep = entry.isFile() ? !SKIPPED_FILES.has(entry.name) : SNAPSHOT_DIRS.has(entry.name)
    if (!keep || !(entry.isFile() || entry.isDirectory())) {
      continue
    }
    cpSync(join(stockDir, entry.name), join(target, entry.name), {
      recursive: true,
      // Clone on APFS: instant and no extra space until either copy changes.
      mode: fsConstants.COPYFILE_FICLONE,
      filter: (source) => !SKIPPED_FILES.has(basename(source))
    })
  }
}

function pruneSnapshots(snapshotsDir: string): void {
  const names = readdirSync(snapshotsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  for (const name of names.slice(0, Math.max(0, names.length - SNAPSHOTS_KEPT))) {
    rmSync(join(snapshotsDir, name), { recursive: true, force: true })
  }
}

/** The first launch of each fork version in shared mode snapshots stock's data. Never fatal. */
function snapshotForVersion(
  forkOwnDir: string,
  stockDir: string,
  version: string,
  now: Date
): string | null {
  if (readSnapshotVersion(forkOwnDir) === version) {
    return null
  }
  // A running app holds the lock: this launch exits at the instance lock, so leave its data be.
  if (isDataDirInUse(stockDir)) {
    return null
  }
  const snapshotsDir = join(forkOwnDir, SNAPSHOTS_DIR_NAME)
  const target = join(snapshotsDir, snapshotName(version, now))
  try {
    snapshotStockData(stockDir, target)
    writeFileSync(
      join(forkOwnDir, SNAPSHOT_STATE_FILE),
      `${JSON.stringify({ version, snapshot: target, at: now.toISOString() }, null, 2)}\n`
    )
    pruneSnapshots(snapshotsDir)
    console.log(`[fork] shared mode: snapshot of stock data at ${target}`)
    return target
  } catch (error) {
    console.error(`[fork] shared mode: stock data snapshot failed: ${String(error)}`)
    rmSync(target, { recursive: true, force: true })
    return null
  }
}

/**
 * Packaged fork only, before anything reads userData and before the instance locks. Pins userData
 * to the fork's "Orca Fork" folder and takes the pre-ready name "Orca Fork", which keeps its
 * Keychain key. With the marker set, points userData at stock Orca's folder and takes its pre-ready
 * name instead, after snapshotting that folder once per fork version.
 */
export function configureForkSharedStockData(
  forkApp: ForkApp,
  { platform = process.platform, now = new Date() }: Options = {}
): SharedDataResult {
  const forkOwnDir = pinForkDataDir(forkApp)
  if (!forkOwnDir) {
    return { mode: 'own' }
  }
  const shared = resolveSharedStockData(forkApp, forkOwnDir, platform)
  if (!shared) {
    forkApp.setName(FORK_PRE_READY_APP_NAME)
    return { mode: 'own' }
  }
  const snapshot = snapshotForVersion(shared.forkOwnDir, shared.stockDir, forkApp.getVersion(), now)
  forkApp.setPath('userData', shared.stockDir)
  forkApp.setName(STOCK_PRE_READY_APP_NAME)
  console.log(`[fork] shared mode: running on ${shared.stockDir}`)
  return { mode: 'shared', stockDir: shared.stockDir, snapshot }
}
