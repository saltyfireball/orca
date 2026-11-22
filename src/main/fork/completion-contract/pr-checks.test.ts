import { describe, expect, it } from 'vitest'
import { evaluatePrChecks, requiredChecks, rollupChecks, type PrChecksPort } from './pr-checks'

const HEAD = 'a'.repeat(40)

function port(view: unknown, required: string | Error, local = HEAD): PrChecksPort {
  return {
    gh: async (args) => {
      if (args[1] === 'view') {
        return JSON.stringify(view)
      }
      if (required instanceof Error) {
        throw required
      }
      return required
    },
    git: async () => `${local}\n`
  }
}

const view = (extra: Record<string, unknown> = {}) => ({
  number: 7,
  state: 'OPEN',
  headRefOid: HEAD,
  statusCheckRollup: [],
  ...extra
})

describe('evaluatePrChecks', () => {
  it('passes when every required check is green on the pushed head', async () => {
    const result = await evaluatePrChecks(
      port(view(), JSON.stringify([{ name: 'ci', bucket: 'pass' }])),
      'feature/x',
      40
    )
    expect(result.ok).toBe(true)
  })

  it('fails and names a failed required check', async () => {
    const result = await evaluatePrChecks(
      port(view(), JSON.stringify([{ name: 'ci', bucket: 'fail' }])),
      'feature/x',
      40
    )
    expect(result).toMatchObject({ ok: false })
    expect(result.pending).toBeUndefined()
    expect(result.output).toContain('ci')
  })

  it('reads the checks from the error when gh exits non-zero while checks run', async () => {
    const error = Object.assign(new Error('exit 8'), {
      stdout: JSON.stringify([{ name: 'ci', bucket: 'pending' }])
    })
    const result = await evaluatePrChecks(port(view(), error), 'feature/x', 40)
    expect(result).toMatchObject({ ok: false, pending: true })
  })

  it('refuses a pull request that is not at the commit the workspace has', async () => {
    const result = await evaluatePrChecks(
      port(view(), JSON.stringify([{ name: 'ci', bucket: 'pass' }]), 'b'.repeat(40)),
      'feature/x',
      40
    )
    expect(result.ok).toBe(false)
    expect(result.output).toContain('Push your latest commit')
  })

  it('refuses a pull request that is not open and a branch it cannot name', async () => {
    expect(
      (await evaluatePrChecks(port(view({ state: 'MERGED' }), '[]'), 'feature/x', 40)).ok
    ).toBe(false)
    expect((await evaluatePrChecks(port(view(), '[]'), '--help', 40)).ok).toBe(false)
    expect((await evaluatePrChecks(port(view(), '[]'), null, 40)).ok).toBe(false)
  })

  it('falls back to every check on the commit when none is required', async () => {
    const result = await evaluatePrChecks(
      port(
        view({ statusCheckRollup: [{ name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' }] }),
        '[]'
      ),
      'feature/x',
      40
    )
    expect(result.ok).toBe(false)
    expect(result.output).toContain('lint')
  })
})

describe('check readers', () => {
  it('reads rollup items of both shapes', () => {
    expect(
      rollupChecks([
        { name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'b', status: 'IN_PROGRESS' },
        { context: 'c', state: 'FAILURE' }
      ]).map((c) => c.state)
    ).toEqual(['pass', 'pending', 'fail'])
  })

  it('returns null for text that is not a check list', () => {
    expect(requiredChecks('no required checks reported')).toBeNull()
  })
})
