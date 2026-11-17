import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ForkServerUpdateSettings } from '../../../shared/fork/server-update'
import type { ForkServerUpdateJob } from '../../../shared/fork/server-update-wire'
import type { ForkFetch } from './server-update-fetch'
import { createForkServerUpdater, type ForkServerUpdaterDeps } from './server-update-service'
import type { ForkRun } from './server-update-stage'
import { settleForkServerUpdateAtStart } from './server-update-state'

const RELEASES = 'https://releases.test/o/r/releases'
const TARBALL = 'orca-server-linux-x64.tar.gz'
const TARBALL_BYTES = Buffer.from('pretend tarball')

let root = ''

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
})

function writeServer(dir: string, version: string): void {
  mkdirSync(join(dir, 'bin'), { recursive: true })
  mkdirSync(join(dir, 'orcad', 'out'), { recursive: true })
  writeFileSync(join(dir, 'bin', 'orca-ide'), '#!/bin/sh\n')
  writeFileSync(join(dir, 'orcad', 'out', 'package.json'), JSON.stringify({ version }))
}

function setup(options: { sha?: string; busy?: number[] } = {}) {
  root = mkdtempSync(join(tmpdir(), 'fork-server-update-'))
  const home = join(root, 'home')
  const userData = join(home, '.config', 'orca')
  const install = join(home, '.local', 'share', 'orca-server')
  mkdirSync(join(home, '.config', 'systemd', 'user'), { recursive: true })
  mkdirSync(userData, { recursive: true })
  writeServer(install, '1.4.259010')
  writeFileSync(
    join(home, '.config', 'systemd', 'user', 'orca-serve.service'),
    `[Service]\nExecStart=${install}/bin/orca-ide serve --supervise\nEnvironment="ORCA_USER_DATA_PATH=${userData}"\n`
  )
  const sha = options.sha ?? createHash('sha256').update(TARBALL_BYTES).digest('hex')
  const fetched: string[] = []
  const fetch: ForkFetch = async (url) => {
    fetched.push(url)
    const body =
      url === `${RELEASES}/download/v1.4.261002/orca-server-sha256sums.txt`
        ? Buffer.from(`${sha}  ${TARBALL}\n`)
        : url === `${RELEASES}/download/v1.4.261002/${TARBALL}`
          ? TARBALL_BYTES
          : null
    return {
      ok: body !== null,
      status: body ? 200 : 404,
      url,
      body: body ? new Blob([body]).stream() : null
    }
  }
  // Stands in for tar: unpacks the "tarball" into a server folder of the new version.
  const run: ForkRun = async (program, args) => {
    if (program === 'tar') {
      writeServer(args[args.indexOf('-C') + 1], '1.4.261002')
      return { code: 0, out: '' }
    }
    return { code: 1, out: `unexpected ${program}` }
  }
  const spawned: string[][] = []
  const busy = [...(options.busy ?? [0])]
  let clock = 1_000
  const deps: ForkServerUpdaterDeps = {
    userDataPath: () => userData,
    version: () => '1.4.259010',
    platform: 'linux',
    arch: 'x64',
    homeDir: home,
    uid: process.getuid?.() ?? null,
    busyTurns: () => (busy.length > 1 ? busy.shift()! : busy[0]),
    fetch,
    run,
    spawnDetached: (program, args) => spawned.push([program, ...args]),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
    newId: () => 'job-1'
  }
  const settings: ForkServerUpdateSettings = { forkServerUpdateReleasesUrl: RELEASES }
  return { deps, settings, install, userData, spawned, fetched }
}

/** The job once it has failed or reached its restart. */
async function settled(
  updater: ReturnType<typeof createForkServerUpdater>,
  settings: ForkServerUpdateSettings
): Promise<ForkServerUpdateJob> {
  return vi.waitFor(async () => {
    const job = (await updater.status(settings)).job
    if (!job || !['failed', 'restarting'].includes(job.phase)) {
      throw new Error(`still ${job?.phase ?? 'idle'}`)
    }
    return job
  })
}

function installedVersion(dir: string): unknown {
  const parsed: unknown = JSON.parse(
    readFileSync(join(dir, 'orcad', 'out', 'package.json'), 'utf8')
  )
  return typeof parsed === 'object' && parsed !== null && 'version' in parsed
    ? parsed.version
    : null
}

describe('fork server updater', () => {
  it('waits for running turns, swaps in the checked release, keeps the old one, and restarts', async () => {
    const t = setup({ busy: [2, 1, 0] })
    const updater = createForkServerUpdater(t.deps)
    expect(await updater.apply(t.settings, { version: '1.4.261002' })).toMatchObject({
      job: { phase: 'downloading', targetVersion: '1.4.261002' }
    })
    const job = await settled(updater, t.settings)
    expect(job.phase).toBe('restarting')
    expect(installedVersion(t.install)).toBe('1.4.261002')
    expect((await updater.status(t.settings)).previousVersion).toBe('1.4.259010')
    // The restart is the service manager's, in a detached watchdog that can roll back.
    expect(t.spawned).toHaveLength(1)
    expect(t.spawned[0][0]).toBe('/bin/sh')
    expect(t.spawned[0].slice(-4)).toEqual(['systemctl', '--user', 'restart', 'orca-serve.service'])
    expect(t.spawned[0]).toContain('job-1')
  })

  it('leaves the install alone when the checksum does not match', async () => {
    const t = setup({ sha: 'f'.repeat(64) })
    const updater = createForkServerUpdater(t.deps)
    await updater.apply(t.settings, { version: '1.4.261002' })
    const job = await settled(updater, t.settings)
    expect(job).toMatchObject({ phase: 'failed', message: `checksum mismatch for ${TARBALL}` })
    expect(installedVersion(t.install)).toBe('1.4.259010')
    expect(t.spawned).toHaveLength(0)
  })

  it('gives up without touching anything when turns are still running after the wait', async () => {
    const t = setup({ busy: [1] })
    const updater = createForkServerUpdater(t.deps)
    await updater.apply(t.settings, { version: '1.4.261002', waitMinutes: 1 })
    const job = await settled(updater, t.settings)
    expect(job.phase).toBe('failed')
    expect(installedVersion(t.install)).toBe('1.4.259010')
    expect(t.spawned).toHaveLength(0)
  })

  it('refuses a downgrade unless asked, and any address from settings that is not https', async () => {
    const t = setup()
    const updater = createForkServerUpdater(t.deps)
    await expect(updater.apply(t.settings, { version: '1.4.258001' })).rejects.toThrow(/not newer/)
    await expect(
      updater.apply(
        { forkServerUpdateReleasesUrl: 'http://releases.test' },
        { version: '1.4.261002' }
      )
    ).rejects.toThrow(/https/)
    await expect(
      updater.apply({ ...t.settings, forkServerUpdateAccept: false }, { version: '1.4.261002' })
    ).rejects.toThrow(/does not take update requests/)
    expect(t.fetched).toEqual([])
  })

  it('rolls back to the kept version, which a later rollback can undo', async () => {
    const t = setup()
    const updater = createForkServerUpdater(t.deps)
    await updater.apply(t.settings, { version: '1.4.261002' })
    await settled(updater, t.settings)
    // The new server came up: it settles the job at start-up.
    const second = createForkServerUpdater({ ...t.deps, version: () => '1.4.261002' })
    await settleForkServerUpdateAtStart(t.userData, '1.4.261002', 2_000)
    expect((await second.status(t.settings)).job).toMatchObject({ phase: 'done' })
    await second.rollback(t.settings, { now: true })
    const job: ForkServerUpdateJob = await settled(second, t.settings)
    expect(job).toMatchObject({
      kind: 'rollback',
      phase: 'restarting',
      targetVersion: '1.4.259010'
    })
    expect(installedVersion(t.install)).toBe('1.4.259010')
    expect((await second.status(t.settings)).previousVersion).toBe('1.4.261002')
  })
})
