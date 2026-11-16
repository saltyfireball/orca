import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FORK_SNOOZE_FILE, ForkSnoozeStore } from './snooze-store'
import { forkSnoozeSettleEnv, runForkSnoozeCommand, settleForkSnooze } from './snooze-settle'

const WS = { kind: 'workspace' as const, worktreeId: 'repo::/w/a', hostId: 'local' }
let dir: string
let store: ForkSnoozeStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fork-snooze-settle-'))
  store = new ForkSnoozeStore(join(dir, FORK_SNOOZE_FILE))
})

afterEach(() => {
  store.dispose()
  rmSync(dir, { recursive: true, force: true })
})

describe('settleForkSnooze', () => {
  it('ends nothing for a reason the snooze was not set for, and runs nothing', async () => {
    const run = vi.fn()
    const entry = await store.snooze(WS, { kind: 'merge' }, 'a')
    const settings = { forkSnoozeSettleCommand: 'echo hi' }
    for (const reason of ['idle', 'attention', 'manual'] as const) {
      expect(
        await settleForkSnooze(store, settings, { id: entry.id, reason, context: {} }, run)
      ).toEqual({ woke: false, cleanup: 'none' })
    }
    expect(run).not.toHaveBeenCalled()
    expect(await store.list()).toHaveLength(1)
  })

  it('ends the snooze without a command when none is set', async () => {
    const run = vi.fn()
    const entry = await store.snooze(WS, { kind: 'idle', days: 1 }, 'a')
    expect(
      await settleForkSnooze(store, {}, { id: entry.id, reason: 'idle', context: {} }, run)
    ).toEqual({ woke: true, cleanup: 'none' })
    expect(run).not.toHaveBeenCalled()
    expect(await store.list()).toEqual([])
  })

  it('runs the configured command once, from the workspace folder, with the facts as data', async () => {
    const run = vi.fn(async () => 'ok' as const)
    const entry = await store.snooze(WS, { kind: 'merge' }, 'feature $(x)')
    const result = await settleForkSnooze(
      store,
      { forkSnoozeSettleCommand: 'my-cleanup' },
      { id: entry.id, reason: 'merged', context: { path: dir, branch: 'feat' } },
      run
    )
    expect(result).toEqual({ woke: true, cleanup: 'ok' })
    expect(run).toHaveBeenCalledTimes(1)
    const [command, options] = run.mock.calls[0] as unknown as [
      string,
      { cwd: string; env: Record<string, string> }
    ]
    expect(command).toBe('my-cleanup')
    expect(options.cwd).toBe(dir)
    expect(options.env).toMatchObject({
      ORCA_SNOOZE_REASON: 'merged',
      ORCA_SNOOZE_PATH: dir,
      ORCA_SNOOZE_BRANCH: 'feat',
      ORCA_SNOOZE_LABEL: 'feature $(x)'
    })
    // A second settle of the same snooze finds nothing.
    expect(
      await settleForkSnooze(
        store,
        { forkSnoozeSettleCommand: 'my-cleanup' },
        { id: entry.id, reason: 'merged', context: {} },
        run
      )
    ).toEqual({ woke: false, cleanup: 'none' })
  })

  it('starts a paired server workspace command in the home folder', async () => {
    const run = vi.fn(async () => 'ok' as const)
    const entry = await store.snooze(
      { kind: 'workspace', worktreeId: 'w', hostId: 'runtime:abc' },
      { kind: 'merge' },
      'remote'
    )
    await settleForkSnooze(
      store,
      { forkSnoozeSettleCommand: 'x' },
      { id: entry.id, reason: 'merged', context: { path: dir } },
      run
    )
    const [, options] = run.mock.calls[0] as unknown as [string, { cwd: string }]
    expect(options.cwd).not.toBe(dir)
  })

  it('strips control characters from the environment values', () => {
    const env = forkSnoozeSettleEnv(
      { id: 'i', target: WS, until: { kind: 'merge' }, label: 'a\nb', snoozedAt: 1 },
      'merged',
      { branch: 'x\u0007y' }
    )
    expect(env.ORCA_SNOOZE_LABEL).toBe('a b')
    expect(env.ORCA_SNOOZE_BRANCH).toBe('x y')
  })
})

describe('runForkSnoozeCommand', () => {
  it('runs the command with the environment and the JSON on standard input', async () => {
    const script = join(dir, 'record.js')
    const out = join(dir, 'out.json')
    writeFileSync(
      script,
      `let input = ''
process.stdin.on('data', (d) => (input += d))
process.stdin.on('end', () => {
  require('node:fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify({ reason: process.env.ORCA_SNOOZE_REASON, input }))
})`
    )
    const outcome = await runForkSnoozeCommand(`"${process.execPath}" "${script}"`, {
      cwd: dir,
      env: { ORCA_SNOOZE_REASON: 'idle', ELECTRON_RUN_AS_NODE: '1' },
      payload: '{"a":1}',
      timeoutMs: 20_000
    })
    expect(outcome).toBe('ok')
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({ reason: 'idle', input: '{"a":1}' })
  })

  it('stops a command that runs past its time', async () => {
    const outcome = await runForkSnoozeCommand(
      `"${process.execPath}" -e "setTimeout(() => {}, 60000)"`,
      { cwd: dir, env: { ELECTRON_RUN_AS_NODE: '1' }, payload: '', timeoutMs: 300 }
    )
    expect(outcome).toBe('timeout')
  })

  it('reports a failing command', async () => {
    const outcome = await runForkSnoozeCommand(`"${process.execPath}" -e "process.exit(3)"`, {
      cwd: dir,
      env: { ELECTRON_RUN_AS_NODE: '1' },
      payload: '',
      timeoutMs: 20_000
    })
    expect(outcome).toBe('failed')
  })
})

describe('settleForkSnooze for a paired device', () => {
  it('ends a paired device snooze without the cleanup command', async () => {
    const run = vi.fn(async () => 'ok' as const)
    const entry = await store.snooze(WS, { kind: 'merge' }, 'a', { noCleanup: true })
    expect(
      await settleForkSnooze(
        store,
        { forkSnoozeSettleCommand: 'my-cleanup' },
        { id: entry.id, reason: 'merged', context: {} },
        run
      )
    ).toEqual({ woke: true, cleanup: 'none' })
    expect(run).not.toHaveBeenCalled()
  })
})
