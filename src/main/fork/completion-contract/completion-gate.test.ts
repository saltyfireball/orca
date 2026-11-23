import Database from '../../sqlite/sync-database'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readCompletionContractSettings } from '../../../shared/fork/completion-contract'
import {
  localCheckRunner,
  parseSshCheckOutput,
  sshCheckCommand,
  type CheckRunner
} from './check-runner'
import { runCompletionGate, type GateDeps, type GateRequest } from './completion-gate'
import { listAttempts, readContract, saveContract } from './contract-store'

const handles: Database.Database[] = []
const dirs: string[] = []

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close()
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function fixture(runner: CheckRunner, cwd = '/tmp', maxRounds?: number) {
  const db = new Database(':memory:')
  handles.push(db)
  const handle = { db }
  const settings = readCompletionContractSettings({ forkCompletionContractMaxRounds: maxRounds })
  const deps: GateDeps = {
    db: handle,
    settings: () => settings,
    workspace: async () => ({
      target: { cwd, connectionId: null },
      branch: 'feature/x',
      git: true,
      runner,
      prPort: { gh: async () => '{}', git: async () => '' }
    })
  }
  const request: GateRequest = {
    taskId: 'task_1',
    dispatchId: 'ctx_1',
    worktreeId: 'wt_1',
    outcome: 'succeeded'
  }
  return { handle, deps, request }
}

const exits = (codes: number[]): CheckRunner => {
  let call = 0
  return async () => ({
    exitCode: codes[Math.min(call++, codes.length - 1)],
    output: 'out',
    timedOut: false
  })
}

describe('runCompletionGate', () => {
  it('leaves a Task with no contract alone', async () => {
    const { deps, request } = fixture(exits([1]))
    expect(await runCompletionGate(deps, request)).toEqual({ kind: 'none' })
  })

  it('does not check a worker that reports failure', async () => {
    const { deps, request, handle } = fixture(exits([1]))
    saveContract(handle, 'task_1', { checks: ['false'], requirePrChecks: false, maxRounds: null })
    expect(await runCompletionGate(deps, { ...request, outcome: 'failed' })).toEqual({
      kind: 'none'
    })
  })

  it('bounces twice, then escalates, recording each attempt', async () => {
    const { deps, request, handle } = fixture(exits([1]))
    saveContract(handle, 'task_1', { checks: ['false'], requirePrChecks: false, maxRounds: null })
    const kinds: string[] = []
    for (let i = 0; i < 3; i++) {
      kinds.push((await runCompletionGate(deps, request)).kind)
    }
    expect(kinds).toEqual(['bounce', 'bounce', 'escalate'])
    expect(readContract(handle, 'task_1')).toMatchObject({ failedRounds: 3, escalated: true })
    const attempts = listAttempts(handle, 'task_1')
    expect(attempts.map((a) => a.outcome)).toEqual(['fail', 'fail', 'fail'])
    expect(attempts[0].results[0]).toMatchObject({ check: 'false', exitCode: 1, output: 'out' })
  })

  it('settles with evidence once the checks pass', async () => {
    const { deps, request, handle } = fixture(exits([1, 0]))
    saveContract(handle, 'task_1', {
      checks: ['pnpm test'],
      requirePrChecks: false,
      maxRounds: null
    })
    expect((await runCompletionGate(deps, request)).kind).toBe('bounce')
    const passed = await runCompletionGate(deps, request)
    expect(passed.kind).toBe('pass')
    expect(passed.kind === 'pass' && passed.evidence).toContain('pnpm test: passed')
  })

  it("takes the Task's own round limit over the setting", async () => {
    const { deps, request, handle } = fixture(exits([1]), '/tmp', 5)
    saveContract(handle, 'task_1', { checks: ['false'], requirePrChecks: false, maxRounds: 1 })
    expect((await runCompletionGate(deps, request)).kind).toBe('bounce')
    expect((await runCompletionGate(deps, request)).kind).toBe('escalate')
  })

  it('is off with the setting off', async () => {
    const { deps, request, handle } = fixture(exits([1]))
    saveContract(handle, 'task_1', { checks: ['false'], requirePrChecks: false, maxRounds: null })
    const off = {
      ...deps,
      settings: () => readCompletionContractSettings({ forkCompletionContract: false })
    }
    expect(await runCompletionGate(off, request)).toEqual({ kind: 'none' })
  })

  it('fails a contract with no workspace to run in', async () => {
    const { deps, request, handle } = fixture(exits([0]))
    saveContract(handle, 'task_1', { checks: ['true'], requirePrChecks: false, maxRounds: null })
    const lost = { ...deps, workspace: async () => null }
    expect((await runCompletionGate(lost, request)).kind).toBe('bounce')
  })
})

describe('a worker on a temp repo', () => {
  it('is turned back until its work makes the check pass', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-contract-'))
    dirs.push(dir)
    execFileSync('git', ['init', '-q', dir])
    const { deps, request, handle } = fixture(localCheckRunner, dir)
    saveContract(handle, 'task_1', {
      checks: ['test -f result.txt && echo found'],
      requirePrChecks: false,
      maxRounds: null
    })
    // The worker says done with nothing written.
    const first = await runCompletionGate(deps, request)
    expect(first.kind).toBe('bounce')
    // It fixes its work and reports again.
    writeFileSync(join(dir, 'result.txt'), 'x')
    const second = await runCompletionGate(deps, request)
    expect(second.kind).toBe('pass')
    expect(listAttempts(handle, 'task_1').map((a) => a.outcome)).toEqual(['fail', 'pass'])
  })

  it('reports a command that is killed at the deadline as failed', async () => {
    const result = await localCheckRunner({ cwd: tmpdir(), connectionId: null }, 'sleep 30', 200)
    expect(result).toMatchObject({ exitCode: null, timedOut: true })
  })

  describe.skipIf(process.platform === 'win32')('a command whose child outlives the shell', () => {
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    const pidsIn = (output: string): number[] =>
      output
        .split('\n')
        .map((line) => Number.parseInt(line, 10))
        .filter((pid) => Number.isInteger(pid) && pid > 1)

    it('settles at the deadline and leaves no child running', async () => {
      const started = Date.now()
      // The shell forks `sleep` (it is not the last command), so killing only the shell leaves it.
      const result = await localCheckRunner(
        { cwd: tmpdir(), connectionId: null },
        'sleep 29 & echo $!; wait',
        500
      )
      expect(Date.now() - started).toBeLessThan(5000)
      expect(result).toMatchObject({ exitCode: null, timedOut: true })
      const [child] = pidsIn(result.output)
      expect(child).toBeDefined()
      // SIGKILL is delivered at once; give the OS a moment to reap.
      await vi.waitFor(() => expect(alive(child)).toBe(false), { timeout: 3000 })
    })

    it('settles even when a stray grandchild in another group holds the pipes', async () => {
      const spawnStray =
        "const c=require('child_process').spawn('sleep',['31'],{detached:true,stdio:['ignore','inherit','inherit']});console.log(c.pid);c.unref()"
      const started = Date.now()
      const result = await localCheckRunner(
        { cwd: tmpdir(), connectionId: null },
        `node -e "${spawnStray}"; sleep 30; true`,
        1500
      )
      const [stray] = pidsIn(result.output)
      try {
        expect(Date.now() - started).toBeLessThan(8000)
        expect(result).toMatchObject({ exitCode: null, timedOut: true })
      } finally {
        // The stray is outside the group by design: stop it by its own pid.
        if (stray && alive(stray)) {
          process.kill(stray, 'SIGKILL')
        }
      }
    })
  })
})

describe('ssh check command', () => {
  it('quotes the directory and carries the exit code back', () => {
    const command = sshCheckCommand("/work/it's", 'pnpm test')
    expect(command.startsWith("cd '/work/it'\\''s' && ")).toBe(true)
    expect(parseSshCheckOutput('line\n\n__ORCA_DONE_CHECK_EXIT__:3\n')).toEqual({
      exitCode: 3,
      output: 'line\n\n'
    })
    expect(parseSshCheckOutput('no marker').exitCode).toBeNull()
  })
})
