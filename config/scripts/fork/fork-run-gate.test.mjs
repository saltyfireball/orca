import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FORK_TEMPLATE_JOB,
  UPSTREAM_ASSEMBLER_JOB,
  UPSTREAM_LANE_GATE_STEP,
  UPSTREAM_TEMPLATE_JOB,
  gateState,
  waitForGate
} from './fork-run-gate.mjs'

const repoRoot = resolve(import.meta.dirname, '../../..')
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8')

const job = (name, status, conclusion = null, steps = []) => ({
  name,
  status,
  conclusion,
  steps
})
const lane = (name, status, conclusion) =>
  job(`${UPSTREAM_TEMPLATE_JOB} / ${name}`, status, conclusion)
const assembler = (status, conclusion, steps) =>
  job(`${UPSTREAM_TEMPLATE_JOB} / ${UPSTREAM_ASSEMBLER_JOB}`, status, conclusion, steps)
const laneGateStep = (status, conclusion = null) => ({
  name: UPSTREAM_LANE_GATE_STEP,
  status,
  conclusion
})

describe('fork run gates', () => {
  it('names the jobs fork-sync.yml defines', () => {
    const workflow = read('.github/workflows/fork-sync.yml')
    expect(workflow).toContain(`\n  ${UPSTREAM_TEMPLATE_JOB}:\n`)
    expect(workflow).toContain(`\n  ${FORK_TEMPLATE_JOB}:\n`)
    for (const gate of ['lanes', 'fork-template', 'qualified']) {
      expect(workflow).toContain(`fork-run-gate.mjs ${gate}\n`)
    }
  })

  it('rejects an unknown gate', () => {
    expect(() => gateState('nope', [])).toThrow(/Unknown gate/)
  })

  describe('lanes', () => {
    it('waits until the assembler is listed and its lane gate has passed', () => {
      expect(gateState('lanes', []).state).toBe('wait')
      expect(gateState('lanes', [job('sync', 'completed', 'success')]).state).toBe('wait')
      expect(gateState('lanes', [assembler('queued')]).state).toBe('wait')
      expect(
        gateState('lanes', [assembler('in_progress', null, [laneGateStep('in_progress')])]).state
      ).toBe('wait')
    })

    it('is ready as soon as upstream reports every lane passed', () => {
      const jobs = [
        lane('persistence (macos-15-intel)', 'completed', 'success'),
        assembler('in_progress', null, [laneGateStep('completed', 'success')])
      ]
      expect(gateState('lanes', jobs).state).toBe('ready')
    })

    it('falls back to the whole assembler job when the step has another name', () => {
      const renamed = [{ name: 'Wait for lanes', status: 'completed', conclusion: 'success' }]
      expect(gateState('lanes', [assembler('in_progress', null, renamed)]).state).toBe('wait')
      expect(gateState('lanes', [assembler('completed', 'success', renamed)]).state).toBe('ready')
    })

    it('fails when a lane, the lane gate or the assembler does not succeed', () => {
      expect(
        gateState('lanes', [lane('linux_musl (x64)', 'completed', 'failure'), assembler('queued')])
      ).toEqual({
        state: 'failed',
        reason: `${UPSTREAM_TEMPLATE_JOB} / linux_musl (x64) ended with failure`
      })
      expect(
        gateState('lanes', [assembler('in_progress', null, [laneGateStep('completed', 'failure')])])
          .state
      ).toBe('failed')
      expect(gateState('lanes', [assembler('completed', 'cancelled')]).state).toBe('failed')
      expect(gateState('lanes', [assembler('completed', 'skipped')]).state).toBe('failed')
    })

    it('ignores jobs outside the upstream template workflow', () => {
      const jobs = [job(FORK_TEMPLATE_JOB, 'completed', 'failure'), assembler('queued')]
      expect(gateState('lanes', jobs).state).toBe('wait')
    })
  })

  describe('fork-template', () => {
    it('follows only the fork template job', () => {
      expect(gateState('fork-template', [assembler('completed', 'success')]).state).toBe('wait')
      expect(gateState('fork-template', [job(FORK_TEMPLATE_JOB, 'in_progress')]).state).toBe('wait')
      expect(
        gateState('fork-template', [job(FORK_TEMPLATE_JOB, 'completed', 'success')]).state
      ).toBe('ready')
      for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out']) {
        expect(
          gateState('fork-template', [job(FORK_TEMPLATE_JOB, 'completed', conclusion)]).state
        ).toBe('failed')
      }
    })
  })

  describe('qualified', () => {
    it('needs every upstream template job finished and passed', () => {
      const passedLane = lane('persistence (ubuntu-latest)', 'completed', 'success')
      const skippedLane = lane('linux_glibc217_compat', 'completed', 'skipped')
      expect(gateState('qualified', [passedLane]).state).toBe('wait')
      expect(gateState('qualified', [passedLane, assembler('in_progress')]).state).toBe('wait')
      expect(
        gateState('qualified', [
          passedLane,
          lane('linux_musl (arm64)', 'in_progress'),
          assembler('completed', 'success')
        ]).state
      ).toBe('wait')
      expect(
        gateState('qualified', [passedLane, skippedLane, assembler('completed', 'success')])
      ).toEqual({
        state: 'ready',
        reason: `all 3 ${UPSTREAM_TEMPLATE_JOB} jobs passed`
      })
    })

    it('fails on any failed job and on a template that was never assembled', () => {
      expect(
        gateState('qualified', [
          lane('persistence (windows-latest)', 'completed', 'cancelled'),
          assembler('in_progress')
        ]).state
      ).toBe('failed')
      expect(gateState('qualified', [assembler('completed', 'failure')]).state).toBe('failed')
      expect(gateState('qualified', [assembler('completed', 'skipped')]).state).toBe('failed')
    })
  })

  describe('waiting on the API', () => {
    const env = {
      GITHUB_API_URL: 'https://api.example.test',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_RUN_ID: '1',
      GITHUB_TOKEN: 'token'
    }
    const MINUTE = 60_000
    const reply = (status, jobs = []) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ jobs })
    })
    const passedJobs = [job(FORK_TEMPLATE_JOB, 'completed', 'success')]

    // A fake network answering from a script, and a clock only the fake sleep moves.
    function harness(answers) {
      let clock = 0
      const calls = []
      const logs = []
      const sleeps = []
      const answer =
        typeof answers === 'function' ? answers : (n) => answers[Math.min(n, answers.length - 1)]
      return {
        calls,
        logs,
        sleeps,
        elapsed: () => clock,
        deps: {
          now: () => clock,
          sleep: async (ms) => {
            sleeps.push(ms)
            clock += ms
          },
          log: (line) => logs.push(line),
          fetch: async (url) => {
            calls.push(url)
            const next = answer(calls.length - 1)
            if (next instanceof Error) {
              throw next
            }
            return next
          }
        }
      }
    }
    const run = (h, gate = 'fork-template') => waitForGate(gate, env, h.deps)

    it('retries a 502 twice and then succeeds', async () => {
      const h = harness([reply(502), reply(502), reply(200, passedJobs)])
      await run(h)
      expect(h.calls).toHaveLength(3)
      expect(h.sleeps).toEqual([5_000, 10_000])
      expect(h.logs.join('\n')).toContain('HTTP 502 (2 in a row)')
    })

    it('retries a 429', async () => {
      const h = harness([reply(429), reply(200, passedJobs)])
      await run(h)
      expect(h.calls).toHaveLength(2)
    })

    it('retries a network error and a body cut off mid-way', async () => {
      const cutOff = {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('terminated')
        }
      }
      const h = harness([new TypeError('fetch failed'), cutOff, reply(200, passedJobs)])
      await run(h)
      expect(h.calls).toHaveLength(3)
      expect(h.logs.join('\n')).toContain('fetch failed')
    })

    it('keeps waiting between errors without counting them against the lane wait', async () => {
      const h = harness([
        reply(200, [job(FORK_TEMPLATE_JOB, 'in_progress')]),
        reply(503),
        reply(200, [job(FORK_TEMPLATE_JOB, 'in_progress')]),
        reply(200, passedJobs)
      ])
      await run(h)
      expect(h.calls).toHaveLength(4)
    })

    it('gives up at the deadline, not before and not after, on a 5xx that never ends', async () => {
      const h = harness(() => reply(500))
      await expect(run(h)).rejects.toThrow(/timed out after 45 minutes \(last error: .*HTTP 500/)
      expect(h.elapsed()).toBe(45 * MINUTE)
      expect(Math.max(...h.sleeps)).toBe(30_000)
      // Far more than the old limit of 12 failures in a row.
      expect(h.calls.length).toBeGreaterThan(80)
    })

    it('fails at once on a real lane failure that follows errors', async () => {
      const h = harness([
        reply(502),
        reply(502),
        reply(200, [job(FORK_TEMPLATE_JOB, 'completed', 'failure')])
      ])
      await expect(run(h)).rejects.toThrow(`fork-template: ${FORK_TEMPLATE_JOB} ended with failure`)
      expect(h.calls).toHaveLength(3)
      expect(h.elapsed()).toBe(15_000)
    })

    it.each([401, 403, 404, 422])('fails at once on HTTP %i', async (status) => {
      const h = harness([reply(status), reply(200, passedJobs)])
      await expect(run(h)).rejects.toThrow(`HTTP ${status}`)
      expect(h.calls).toHaveLength(1)
      expect(h.sleeps).toEqual([])
    })

    it('fails at once on a 4xx that follows a 502', async () => {
      const h = harness([reply(502), reply(404)])
      await expect(run(h)).rejects.toThrow('HTTP 404')
      expect(h.calls).toHaveLength(2)
    })

    it('still times out at the deadline while only waiting for a lane', async () => {
      const h = harness(() => reply(200, [job(FORK_TEMPLATE_JOB, 'in_progress')]))
      await expect(run(h)).rejects.toThrow(/timed out after 45 minutes \(.*is in_progress/)
      expect(h.elapsed()).toBe(45 * MINUTE)
    })

    it('needs the workflow environment and a known gate before any request', async () => {
      const h = harness([reply(200)])
      await expect(waitForGate('lanes', { ...env, GITHUB_TOKEN: '' }, h.deps)).rejects.toThrow(
        /GITHUB_TOKEN is not set/
      )
      await expect(run(h, 'nope')).rejects.toThrow(/Unknown gate/)
      expect(h.calls).toHaveLength(0)
    })
  })
})
