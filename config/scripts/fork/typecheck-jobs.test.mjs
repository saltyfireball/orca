import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveTypecheckCommand,
  runTypecheckProjects,
  TSRS_DEFAULT_CHECKERS,
  TYPECHECK_PROJECTS
} from '../typecheck/project-execution/run-typecheck-projects-in-parallel.mjs'
import {
  forkTypecheckCheckers,
  forkTypecheckParallelism,
  TYPECHECK_CHECKERS_ENV,
  TYPECHECK_JOBS_ENV
} from './typecheck-jobs.mjs'

describe('forkTypecheckParallelism', () => {
  it('leaves the parallelism alone when the cap is unset or empty', () => {
    expect(forkTypecheckParallelism(8, {})).toBe(8)
    expect(forkTypecheckParallelism(8, { [TYPECHECK_JOBS_ENV]: '' })).toBe(8)
    expect(forkTypecheckParallelism(8, { [TYPECHECK_JOBS_ENV]: '  ' })).toBe(8)
  })

  it('lowers the parallelism to the cap and never raises it', () => {
    expect(forkTypecheckParallelism(8, { [TYPECHECK_JOBS_ENV]: '1' })).toBe(1)
    expect(forkTypecheckParallelism(8, { [TYPECHECK_JOBS_ENV]: ' 2 ' })).toBe(2)
    expect(forkTypecheckParallelism(2, { [TYPECHECK_JOBS_ENV]: '16' })).toBe(2)
  })

  it('refuses a cap that is not a positive integer', () => {
    for (const value of ['0', '-1', '1.5', 'two', '2x']) {
      expect(() => forkTypecheckParallelism(8, { [TYPECHECK_JOBS_ENV]: value })).toThrow(
        /must be a positive integer/
      )
    }
  })
})

describe('forkTypecheckCheckers', () => {
  it('lowers the checker count to the cap, and leaves it alone when unset', () => {
    expect(forkTypecheckCheckers(8, {})).toBe(8)
    expect(forkTypecheckCheckers(8, { [TYPECHECK_CHECKERS_ENV]: '2' })).toBe(2)
    expect(forkTypecheckCheckers(8, { [TYPECHECK_CHECKERS_ENV]: '32' })).toBe(8)
    expect(() => forkTypecheckCheckers(8, { [TYPECHECK_CHECKERS_ENV]: '0' })).toThrow(
      /must be a positive integer/
    )
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveTypecheckCommand with the checker cap', () => {
  const checkersOf = (options) => {
    const { args } = resolveTypecheckCommand('config/tsconfig.tc.cli.json', {
      compiler: 'tsrs',
      root: process.cwd(),
      ...options
    })
    return args.slice(args.indexOf('--checkers'))
  }

  it('passes the capped count to tsrs, and the stock count without the cap', () => {
    vi.stubEnv(TYPECHECK_CHECKERS_ENV, '')
    expect(checkersOf({})).toEqual(['--checkers', String(TSRS_DEFAULT_CHECKERS)])
    vi.stubEnv(TYPECHECK_CHECKERS_ENV, '2')
    expect(checkersOf({})).toEqual(['--checkers', '2'])
  })

  it('lets an explicit checker count win over the cap', () => {
    vi.stubEnv(TYPECHECK_CHECKERS_ENV, '2')
    expect(checkersOf({ checkers: 6 })).toEqual(['--checkers', '6'])
  })
})

describe('runTypecheckProjects with the cap', () => {
  // Counts the compilers alive at once while every project is checked.
  async function peakCompilers(compiler) {
    const children = []
    let running = 0
    let peak = 0
    const result = runTypecheckProjects({
      compiler,
      bunConcurrency: 2,
      memoryBytes: 64 * 1024 ** 3,
      root: process.cwd(),
      spawnCompiler: () => {
        const child = new EventEmitter()
        running += 1
        peak = Math.max(peak, running)
        children.push(child)
        return child
      }
    })
    for (let index = 0; index < TYPECHECK_PROJECTS.length; index++) {
      await vi.waitFor(() => expect(children.length).toBeGreaterThan(index))
      // Let a peer slot start its compiler before this one ends.
      await new Promise((resolve) => setImmediate(resolve))
      running -= 1
      children[index].emit('close', 0, null)
    }
    expect(await result).toEqual([])
    return peak
  }

  it.each(['tsrs', 'native'])('runs one %s compiler at a time when the cap is 1', async (name) => {
    vi.stubEnv(TYPECHECK_JOBS_ENV, '1')
    expect(await peakCompilers(name)).toBe(1)
  })

  it('keeps the stock two tsrs compilers without the cap', async () => {
    vi.stubEnv(TYPECHECK_JOBS_ENV, '')
    expect(await peakCompilers('tsrs')).toBe(2)
  })
})
