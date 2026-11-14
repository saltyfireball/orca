import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FORK_TEMPLATE_JOB,
  UPSTREAM_ASSEMBLER_JOB,
  UPSTREAM_LANE_GATE_STEP,
  UPSTREAM_TEMPLATE_JOB,
  gateState
} from './fork-run-gate.mjs'

const repoRoot = resolve(import.meta.dirname, '../../..')
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8')

const job = (name, status, conclusion = null, steps = []) => ({ name, status, conclusion, steps })
const lane = (name, status, conclusion) => job(`${UPSTREAM_TEMPLATE_JOB} / ${name}`, status, conclusion)
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
      expect(gateState('fork-template', [job(FORK_TEMPLATE_JOB, 'completed', 'success')]).state).toBe(
        'ready'
      )
      for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out']) {
        expect(gateState('fork-template', [job(FORK_TEMPLATE_JOB, 'completed', conclusion)]).state).toBe(
          'failed'
        )
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
      ).toEqual({ state: 'ready', reason: `all 3 ${UPSTREAM_TEMPLATE_JOB} jobs passed` })
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
})
