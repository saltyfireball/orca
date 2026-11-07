import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  configureForkSharedStockData,
  isDataDirInUse,
  SHARED_DATA_MARKER,
  SNAPSHOT_STATE_FILE,
  SNAPSHOTS_DIR_NAME,
  SNAPSHOTS_KEPT
} from './shared-stock-data'

let appData: string
let forkDir: string
let stockDir: string

function fakeApp(overrides: { isPackaged?: boolean; userData?: string; version?: string } = {}) {
  const paths = { appData, userData: overrides.userData ?? forkDir }
  return {
    isPackaged: overrides.isPackaged ?? true,
    getPath: vi.fn((name: 'appData' | 'userData') => paths[name]),
    setPath: vi.fn((name: 'userData', path: string) => {
      paths[name] = path
    }),
    setName: vi.fn(),
    getVersion: () => overrides.version ?? '1.4.253004'
  }
}

function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

beforeEach(() => {
  appData = mkdtempSync(join(tmpdir(), 'fork-shared-'))
  forkDir = join(appData, 'Orca Fork')
  stockDir = join(appData, 'orca')
  mkdirSync(forkDir)
  write(join(stockDir, 'profiles', 'local-default', 'profile-state.db'), 'profile')
  write(join(stockDir, 'agent-session-journal.db'), 'chats')
  write(join(stockDir, 'SingletonCookie'), 'cookie')
  write(join(stockDir, 'Cache', 'big.bin'), 'cache')
  write(join(stockDir, 'speech-models', 'model.bin'), 'model')
})

afterEach(() => {
  rmSync(appData, { recursive: true, force: true })
})

const darwin = { platform: 'darwin' as const, now: new Date('2026-11-07T12:00:00Z') }

function share(): void {
  writeFileSync(join(forkDir, SHARED_DATA_MARKER), '')
}

describe('configureForkSharedStockData', () => {
  it('keeps the fork on its own data without the marker', () => {
    const forkApp = fakeApp()
    expect(configureForkSharedStockData(forkApp, darwin)).toEqual({ mode: 'own' })
    expect(forkApp.setPath).not.toHaveBeenCalled()
    expect(forkApp.setName).not.toHaveBeenCalled()
    expect(existsSync(join(forkDir, SNAPSHOTS_DIR_NAME))).toBe(false)
  })

  it('runs on stock data with stock Keychain naming when the marker is set', () => {
    share()
    const forkApp = fakeApp()
    expect(configureForkSharedStockData(forkApp, darwin)).toMatchObject({
      mode: 'shared',
      stockDir
    })
    expect(forkApp.setPath).toHaveBeenCalledWith('userData', stockDir)
    expect(forkApp.setName).toHaveBeenCalledWith('orca')
  })

  it('ignores the marker unpackaged, off macOS, outside the fork, or with no stock data', () => {
    share()
    expect(configureForkSharedStockData(fakeApp({ isPackaged: false }), darwin).mode).toBe('own')
    expect(configureForkSharedStockData(fakeApp(), { platform: 'linux' }).mode).toBe('own')
    const other = join(appData, 'orca-dev')
    mkdirSync(other)
    writeFileSync(join(other, SHARED_DATA_MARKER), '')
    expect(configureForkSharedStockData(fakeApp({ userData: other }), darwin).mode).toBe('own')
    rmSync(stockDir, { recursive: true })
    expect(configureForkSharedStockData(fakeApp(), darwin).mode).toBe('own')
  })
})

describe('shared mode snapshots', () => {
  it('snapshots settings and chats once per version, without caches, models or locks', () => {
    share()
    const result = configureForkSharedStockData(fakeApp(), darwin)
    const target = result.mode === 'shared' ? result.snapshot : null
    expect(target).not.toBeNull()
    expect(
      readFileSync(join(target!, 'profiles', 'local-default', 'profile-state.db'), 'utf8')
    ).toBe('profile')
    expect(readFileSync(join(target!, 'agent-session-journal.db'), 'utf8')).toBe('chats')
    expect(existsSync(join(target!, 'SingletonCookie'))).toBe(false)
    expect(existsSync(join(target!, 'Cache'))).toBe(false)
    expect(existsSync(join(target!, 'speech-models'))).toBe(false)
    expect(JSON.parse(readFileSync(join(forkDir, SNAPSHOT_STATE_FILE), 'utf8')).version).toBe(
      '1.4.253004'
    )
    expect(configureForkSharedStockData(fakeApp(), darwin)).toMatchObject({ snapshot: null })
  })

  it('skips the snapshot while a running app holds the stock folder', () => {
    share()
    symlinkSync(`${hostname()}-${process.pid}`, join(stockDir, 'SingletonLock'))
    expect(isDataDirInUse(stockDir)).toBe(true)
    expect(configureForkSharedStockData(fakeApp(), darwin)).toMatchObject({
      mode: 'shared',
      snapshot: null
    })
    expect(existsSync(join(forkDir, SNAPSHOT_STATE_FILE))).toBe(false)
  })

  it('treats a lock from a finished process or another host as free', () => {
    symlinkSync('other-host-1', join(stockDir, 'SingletonLock'))
    expect(isDataDirInUse(stockDir)).toBe(false)
    rmSync(join(stockDir, 'SingletonLock'))
    symlinkSync(`${hostname()}-2147483646`, join(stockDir, 'SingletonLock'))
    expect(isDataDirInUse(stockDir)).toBe(false)
  })

  it(`keeps the newest ${SNAPSHOTS_KEPT} snapshots`, () => {
    share()
    for (let release = 1; release <= SNAPSHOTS_KEPT + 2; release++) {
      configureForkSharedStockData(fakeApp({ version: `1.4.25300${release}` }), {
        platform: 'darwin',
        now: new Date(Date.UTC(2026, 10, release))
      })
    }
    const kept = readdirSync(join(forkDir, SNAPSHOTS_DIR_NAME)).sort()
    expect(kept).toHaveLength(SNAPSHOTS_KEPT)
    expect(kept.at(-1)).toContain(`v1.4.25300${SNAPSHOTS_KEPT + 2}`)
    expect(kept.some((name) => name.endsWith('v1.4.253001'))).toBe(false)
  })
})
