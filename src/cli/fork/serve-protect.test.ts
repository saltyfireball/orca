// SLRM-2384: `orca serve service protect|unprotect|protect status` against a temp home and a stub
// systemctl that answers like a user manager with orca-serve.service installed. Nothing real runs.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { protectServeService, readServeProtectStatus, unprotectServeService } from './serve-protect'
import type { ServeProtectDeps } from './serve-protect-systemd'
import { getPlatformUserDataPath } from '../runtime/profile/metadata'
import { SERVE_PROTECT_CHILD_OOM_ENV, SERVE_PROTECT_MARKER } from '../../shared/fork/serve-protect'
import { readServeProtectOptions } from './serve-protect-handlers'

let home: string
let unitDir: string
let calls: string[]
let installed: boolean

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'orca-serve-protect-'))
  unitDir = join(home, '.config', 'systemd', 'user')
  await mkdir(unitDir, { recursive: true })
  await writeFile(join(unitDir, 'orca-serve.service'), '[Service]\nExecStart=/bin/true\n')
  calls = []
  installed = true
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const SYSTEM: Record<string, string> = {
  'user@501.service': 'LoadState=loaded\nMainPID=900\nMemoryMin=0\nMemoryLow=0\nOOMScoreAdjust=100',
  'user.slice': 'LoadState=loaded\nMemoryMin=0\nMemoryLow=0\nOOMScoreAdjust=0',
  'user-501.slice': 'LoadState=loaded\nMemoryMin=infinity\nMemoryLow=infinity\nOOMScoreAdjust=0',
  'tailscaled.service': 'LoadState=loaded\nMemoryMin=0\nMemoryLow=0\nOOMScoreAdjust=0',
  'ssh.service': 'LoadState=loaded\nMemoryMin=0\nMemoryLow=0\nOOMScoreAdjust=-1000',
  'sshd.service': 'LoadState=not-found'
}

function deps(platform: NodeJS.Platform = 'linux'): ServeProtectDeps {
  return {
    platform,
    env: { ORCA_USER_DATA_PATH: getPlatformUserDataPath('linux', home) },
    homeDir: home,
    uid: 501,
    readProc: (path) =>
      ({ '/proc/900/oom_score_adj': '100\n', '/proc/1234/oom_score_adj': '200\n' })[path] ?? null,
    run: async (program, args) => {
      calls.push([program, ...args].join(' '))
      if (args[0] === '--user' && args[1] === 'show') {
        const dropIn = join(unitDir, 'orca-serve.service.d', '50-blackfish-protect.conf')
        return installed
          ? {
              code: 0,
              out: `LoadState=loaded\nFragmentPath=${join(unitDir, 'orca-serve.service')}\nDropInPaths=${existsSync(dropIn) ? dropIn : ''}\nMainPID=1234\nSlice=app.slice\nOOMScoreAdjust=200\nMemoryMin=0\nMemoryLow=0\n`
            }
          : { code: 0, out: 'LoadState=not-found\nFragmentPath=\n' }
      }
      if (args[0] === 'show') {
        return { code: 0, out: SYSTEM[args[1]] ?? 'LoadState=not-found' }
      }
      return { code: 0, out: '' }
    }
  }
}

const defaults = () => readServeProtectOptions(new Map())

describe('orca serve service protect', () => {
  it('writes the unit and slice drop-ins, reloads, applies memory now and prints root steps', async () => {
    const result = await protectServeService(defaults(), deps())
    const dropIn = join(unitDir, 'orca-serve.service.d', '50-blackfish-protect.conf')
    const text = await readFile(dropIn, 'utf8')
    expect(text.startsWith(SERVE_PROTECT_MARKER)).toBe(true)
    expect(text).toContain('OOMScoreAdjust=100\n')
    expect(text).toContain('MemoryMin=256M\nMemoryLow=1G\n')
    expect(text).toContain(`Environment=${SERVE_PROTECT_CHILD_OOM_ENV}=300\n`)
    expect(
      await readFile(join(unitDir, 'app.slice.d', '50-blackfish-protect.conf'), 'utf8')
    ).toContain('[Slice]\nMemoryMin=256M\nMemoryLow=1G\n')
    // The unit file itself is never rewritten.
    expect(await readFile(join(unitDir, 'orca-serve.service'), 'utf8')).toBe(
      '[Service]\nExecStart=/bin/true\n'
    )
    expect(calls).toContain('systemctl --user daemon-reload')
    expect(calls).toContain(
      'systemctl --user set-property --runtime orca-serve.service MemoryMin=256M MemoryLow=1G'
    )
    expect(calls.some((line) => line.includes('restart'))).toBe(false)
    expect(calls.some((line) => line.startsWith('sudo'))).toBe(false)
    const steps = result.rootSteps as string[]
    expect(steps).toContain('sudo systemctl set-property user.slice MemoryMin=256M MemoryLow=1G')
    expect(steps).toContain(
      'sudo systemctl set-property user@501.service MemoryMin=256M MemoryLow=1G'
    )
    // Already protected enough: no step for user-501.slice or ssh.
    expect(steps.some((step) => step.includes('user-501.slice'))).toBe(false)
    expect(steps.some((step) => step.includes('ssh'))).toBe(false)
    expect(steps.some((step) => step.includes('tailscaled.service.d'))).toBe(true)
  })

  it('raises a score below the user manager floor to the floor', async () => {
    const options = { ...defaults(), oomScoreAdjust: -500 }
    const result = await protectServeService(options, deps())
    expect(result.content).toContain('OOMScoreAdjust=100\n')
    expect((result.notes as string[]).join(' ')).toContain('(100)')
  })

  it('writes nothing on a dry run', async () => {
    const result = await protectServeService({ ...defaults(), dryRun: true }, deps())
    expect(result.dryRun).toBe(true)
    expect(existsSync(join(unitDir, 'orca-serve.service.d'))).toBe(false)
    expect(calls.some((line) => line.includes('daemon-reload'))).toBe(false)
  })

  it('refuses to overwrite a drop-in it did not write', async () => {
    await mkdir(join(unitDir, 'orca-serve.service.d'))
    await writeFile(
      join(unitDir, 'orca-serve.service.d', '50-blackfish-protect.conf'),
      '[Service]\n'
    )
    await expect(protectServeService(defaults(), deps())).rejects.toThrow(/not written by/)
  })

  it('refuses off Linux and without an installed unit', async () => {
    await expect(protectServeService(defaults(), deps('darwin'))).rejects.toThrow(/Linux only/)
    installed = false
    await expect(protectServeService(defaults(), deps())).rejects.toThrow(/not installed/)
  })

  it('unprotect removes only its own drop-ins and clears memory now', async () => {
    await protectServeService(defaults(), deps())
    await writeFile(join(unitDir, 'app.slice.d', 'other.conf'), '[Slice]\n')
    calls = []
    const result = await unprotectServeService(deps())
    expect(result.removed).toBe(true)
    expect(existsSync(join(unitDir, 'orca-serve.service.d', '50-blackfish-protect.conf'))).toBe(
      false
    )
    expect(existsSync(join(unitDir, 'app.slice.d', '50-blackfish-protect.conf'))).toBe(false)
    expect(existsSync(join(unitDir, 'app.slice.d', 'other.conf'))).toBe(true)
    expect(calls).toContain(
      'systemctl --user set-property --runtime orca-serve.service MemoryMin=0 MemoryLow=0'
    )
    expect((await unprotectServeService(deps())).removed).toBe(false)
  })

  it('status reports the drop-in, the scores and the system units', async () => {
    await protectServeService(defaults(), deps())
    const status = await readServeProtectStatus(deps())
    expect(status).toMatchObject({
      name: 'orca-serve.service',
      protected: true,
      dropInLoaded: true,
      serverOomScore: 200,
      userManagerFloor: 100
    })
    expect((status.system as { unit: string }[]).map((entry) => entry.unit)).toEqual([
      'user.slice',
      'user-501.slice',
      'user@501.service',
      'tailscaled.service',
      'ssh.service'
    ])
  })

  it('validates its flags', () => {
    expect(() => readServeProtectOptions(new Map([['memory-min', '1G\nExecStart=x']]))).toThrow(
      /--memory-min/
    )
    expect(() => readServeProtectOptions(new Map([['oom-score-adjust', '-2000']]))).toThrow(
      /--oom-score-adjust/
    )
    expect(readServeProtectOptions(new Map([['memory-low', 'off']])).memoryLow).toBeNull()
  })
})
