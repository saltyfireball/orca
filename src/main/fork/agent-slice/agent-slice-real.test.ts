// BAD-684: the slice limits and the scope lifetime against a real systemd user manager. Runs only
// on Linux with `ORCA_REAL_SLICE_TEST=1`; every unit it makes carries a unique `orcatest684`
// prefix, has a runtime limit so a runaway ends by itself, and is stopped by its exact name at the
// end. The memory limits are small (MemoryHigh 128M, MemoryMax 256M). Nothing else is touched.
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { userManagerEnv } from '../../daemon/process-scopes/daemon-cgroup-scope'
import {
  resolveTerminalScopes,
  type TerminalScopeRuntime
} from '../../daemon/process-scopes/terminal-scopes'
import { applyAgentSliceLimits } from './agent-slice-limits'

const enabled = process.platform === 'linux' && process.env.ORCA_REAL_SLICE_TEST === '1'
const HIGH = 128 * 1024 ** 2
const MAX = 256 * 1024 ** 2
const HOLD_MS = Number(process.env.ORCA_REAL_SLICE_HOLD_MS ?? 0)
const RUNTIME_MAX_SECONDS = 120

const managerEnv = enabled ? userManagerEnv(process.env) : {}
const systemctl = (...args: string[]): string =>
  execFileSync('systemctl', ['--user', ...args], { encoding: 'utf8', env: managerEnv }).trim()
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(predicate: () => boolean, message: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await delay(100)
  }
  throw new Error(message)
}
const isActive = (unit: string): boolean =>
  spawnSync('systemctl', ['--user', 'is-active', '--quiet', unit], { env: managerEnv }).status === 0

type Fixture = { daemonUnit: string; daemon: ChildProcess; scopes: TerminalScopeRuntime }
const units: string[] = []

/** A stand-in for the terminal host: its own scope, with the terminal slice bound to it as in `resolveTerminalScopes`. */
async function startFixture(name: string): Promise<Fixture> {
  const daemonUnit = `${name}.scope`
  units.push(daemonUnit)
  const daemon = spawn(
    'systemd-run',
    [
      '--user',
      '--scope',
      '--quiet',
      '--collect',
      `--unit=${name}`,
      `--property=RuntimeMaxSec=${RUNTIME_MAX_SECONDS}`,
      '--property=TimeoutStopSec=5s',
      '--',
      'sleep',
      String(RUNTIME_MAX_SECONDS - 10)
    ],
    { env: managerEnv, stdio: 'ignore' }
  )
  await until(() => isActive(daemonUnit), 'the stand-in daemon scope never started')
  const resolved = resolveTerminalScopes({
    env: process.env,
    platform: 'linux',
    daemonScope: daemonUnit
  })
  if (!('on' in resolved.scopes)) {
    throw new Error(`terminal scopes are off here: ${JSON.stringify(resolved.scopes)}`)
  }
  units.push(resolved.scopes.on.slice)
  return { daemonUnit, daemon, scopes: resolved.scopes.on }
}

/** What `wrapPtySpawnInTerminalScope` runs for a terminal, with the test's own extra limits. */
function startInSlice(fixture: Fixture, unit: string, extra: string[], command: string[]) {
  units.push(`${unit}.scope`)
  return spawn(
    fixture.scopes.systemdRun,
    [
      '--user',
      '--scope',
      '--quiet',
      '--collect',
      `--slice=${fixture.scopes.slice}`,
      `--unit=${unit}.scope`,
      ...fixture.scopes.properties.map((property) => `--property=${property}`),
      `--property=RuntimeMaxSec=${RUNTIME_MAX_SECONDS}`,
      ...extra.map((property) => `--property=${property}`),
      '--',
      ...command
    ],
    { env: managerEnv, stdio: 'ignore' }
  )
}

const cgroupFile = (path: string, name: string): string =>
  readFileSync(join(path, name), 'utf8').trim()
const eventCount = (path: string, key: string): number =>
  Number(new RegExp(`^${key} (\\d+)$`, 'm').exec(cgroupFile(path, 'memory.events'))?.[1] ?? 0)

const HOG = `
const chunks = []
for (let i = 0; i < 16; i += 1) { chunks.push(Buffer.alloc(32 * 1024 * 1024, 1)) }
setInterval(() => { for (const c of chunks) { c[Math.floor(Math.random() * c.length)] = 2 } }, 50)
`

afterAll(() => {
  // Exact names only, newest first; a unit already gone is fine.
  for (const unit of units.toReversed()) {
    spawnSync('systemctl', ['--user', 'stop', unit], { env: managerEnv, timeout: 15_000 })
  }
})

describe.runIf(enabled)('agent slice against a real systemd user manager', () => {
  let name: string
  beforeAll(() => {
    name = `orcatest684-${process.pid}-${Date.now().toString(36)}`
  })

  it('throttles a process allocating past MemoryHigh while an outside process stays responsive', async () => {
    const fixture = await startFixture(`${name}-a`)
    const idle = startInSlice(fixture, `${name.replace(/-/g, '_')}_a_idle`, [], ['sleep', '100'])
    await until(() => existsSync(fixture.scopes.sliceCgroupPath), 'the slice never appeared')
    const report = applyAgentSliceLimits({
      slice: fixture.scopes.slice,
      sliceCgroupPath: fixture.scopes.sliceCgroupPath,
      request: {
        properties: ['CPUWeight=10', 'IOWeight=10', 'TasksMax=512', `MemoryHigh=${HIGH}`],
        invalid: []
      },
      run: (args) => {
        const result = spawnSync('systemctl', args, { env: managerEnv, timeout: 5_000 })
        return { code: result.status, timedOut: result.error !== undefined }
      }
    })
    // A host may not delegate every controller (io often is not): refusing one is the fallback
    // working, but the memory limit under test must be enforced.
    expect(report.applied).toEqual(expect.arrayContaining([`MemoryHigh=${HIGH}`]))
    expect(report.refused.filter((property) => !property.startsWith('IOWeight'))).toEqual([])
    expect(cgroupFile(fixture.scopes.sliceCgroupPath, 'memory.high')).toBe(String(HIGH))

    const hog = startInSlice(
      fixture,
      `${name.replace(/-/g, '_')}_a_hog`,
      [`MemoryMax=${MAX}`, 'MemorySwapMax=256M'],
      [process.execPath, '-e', HOG]
    )
    await until(
      () => eventCount(fixture.scopes.sliceCgroupPath, 'high') > 0,
      'the slice was never throttled at MemoryHigh'
    )
    await delay(Math.max(HOLD_MS, 3_000))
    // An outside process (this one, and a fresh child) answers while the slice is throttled.
    const started = Date.now()
    spawnSync('true')
    const roundTripMs = Date.now() - started
    const current = Number(cgroupFile(fixture.scopes.sliceCgroupPath, 'memory.current'))
    const high = eventCount(fixture.scopes.sliceCgroupPath, 'high')
    console.log(
      JSON.stringify({
        sliceHighEvents: high,
        sliceMemoryCurrentMiB: Math.round(current / 1024 ** 2),
        pressure: cgroupFile(fixture.scopes.sliceCgroupPath, 'memory.pressure'),
        outsideSpawnMs: roundTripMs
      })
    )
    expect(high).toBeGreaterThan(0)
    // Held near MemoryHigh (reclaim runs beside the allocation), far below what the hog asked for.
    expect(current).toBeLessThan(MAX)
    expect(roundTripMs).toBeLessThan(2_000)
    expect(isActive(fixture.daemonUnit)).toBe(true)
    hog.kill('SIGKILL')
    idle.kill('SIGKILL')
  }, 90_000)

  it('removes the slice and its terminals when the daemon is killed with SIGKILL', async () => {
    const fixture = await startFixture(`${name}-b`)
    const terminalUnit = `${name.replace(/-/g, '_')}_b_term`
    startInSlice(fixture, terminalUnit, [], ['sleep', '100'])
    await until(() => isActive(`${terminalUnit}.scope`), 'the terminal scope never started')
    const group = systemctl('show', '-p', 'ControlGroup', '--value', fixture.daemonUnit)
    const [pid] = readFileSync(`/sys/fs/cgroup${group}/cgroup.procs`, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(Number)
    expect(pid).toBeGreaterThan(1)
    process.kill(pid, 'SIGKILL')
    await until(
      () =>
        !existsSync(fixture.scopes.sliceCgroupPath) &&
        !isActive(`${terminalUnit}.scope`) &&
        !isActive(fixture.scopes.slice),
      'the slice or its terminal outlived the daemon'
    )
  }, 60_000)
})
