import { describe, expect, it } from 'vitest'
import { parseArgs } from '../arguments/args'
import { getOptionalNonNegativeIntegerFlag } from '../arguments/flags'
import { FORK_SERVERS_COMMAND_SPECS } from './servers-specs'
import { forkFlagTakesValue } from './value-flags'

const PATHS = [
  ['servers', 'update'],
  ['servers', 'rollback'],
  ['terminal', 'wait']
]

function parse(argv: string[]) {
  return parseArgs(argv, PATHS, FORK_SERVERS_COMMAND_SPECS)
}

describe('fork value flags (SLRM-2310)', () => {
  it('reads `servers update --wait 5` like `--wait=5`', () => {
    for (const argv of [
      ['servers', 'update', 'alpha', '--wait', '5'],
      ['servers', 'update', 'alpha', '--wait=5']
    ]) {
      const parsed = parse(argv)
      expect(parsed.commandPath).toEqual(['servers', 'update', 'alpha'])
      expect(getOptionalNonNegativeIntegerFlag(parsed.flags, 'wait')).toBe(5)
    }
  })

  it('reads `servers rollback --wait 0` before the server name', () => {
    const parsed = parse(['servers', 'rollback', '--wait', '0', 'alpha'])
    expect(parsed.commandPath).toEqual(['servers', 'rollback', 'alpha'])
    expect(parsed.flags.get('wait')).toBe('0')
  })

  it('keeps a following flag out of the value', () => {
    const parsed = parse(['servers', 'update', '--all', '--wait', '--now'])
    expect(parsed.flags.get('wait')).toBe(true)
    expect(parsed.flags.get('now')).toBe(true)
  })

  it('leaves --wait boolean on every other command', () => {
    const parsed = parse(['terminal', 'wait', '--wait', 'x'])
    expect(parsed.flags.get('wait')).toBe(true)
    expect(parsed.commandPath).toEqual(['terminal', 'wait', 'x'])
    expect(forkFlagTakesValue(['servers'], 'wait')).toBe(false)
    expect(forkFlagTakesValue(['servers', 'update'], 'all')).toBe(false)
  })
})
