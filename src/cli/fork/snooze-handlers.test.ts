// Snooze (FORK.md): `orca snooze` routing and its table.
import { describe, expect, it } from 'vitest'
import { normalizeCommandPositionals, parseArgs } from '../arguments/args'
import { FORK_SNOOZE_COMMAND_SPECS } from './snooze-specs'
import { formatSnoozeList } from './snooze-handlers'

function route(argv: string[]) {
  const paths = FORK_SNOOZE_COMMAND_SPECS.map((spec) => spec.path)
  return normalizeCommandPositionals(
    FORK_SNOOZE_COMMAND_SPECS,
    parseArgs(argv, paths, FORK_SNOOZE_COMMAND_SPECS)
  )
}

describe('orca snooze routing', () => {
  it('reads list and wake as subcommands, anything else as the target', () => {
    expect(route(['snooze', 'list']).commandPath).toEqual(['snooze', 'list'])
    expect(route(['snooze', 'ls']).commandPath).toEqual(['snooze', 'list'])
    const wake = route(['snooze', 'wake', 'abcd12'])
    expect(wake.commandPath).toEqual(['snooze', 'wake'])
    expect(wake.flags.get('id')).toBe('abcd12')
    const set = route(['snooze', 'branch:fix', '--until', 'merge'])
    expect(set.commandPath).toEqual(['snooze'])
    expect(set.flags.get('target')).toBe('branch:fix')
    expect(set.flags.get('until')).toBe('merge')
    expect(route(['snooze', '--until', '2h']).commandPath).toEqual(['snooze'])
  })
})

describe('formatSnoozeList', () => {
  it('prints one row per snooze with its wake label', () => {
    const text = formatSnoozeList({
      now: new Date(2026, 10, 18, 10).getTime(),
      entries: [
        {
          id: 'abcdef123456',
          target: { kind: 'workspace', worktreeId: 'w', hostId: 'runtime:srv' },
          until: { kind: 'merge' },
          label: 'feature',
          snoozedAt: 0
        },
        {
          id: '0123456789ab',
          target: { kind: 'chat', paneKey: 't:l', worktreeId: 'w', hostId: 'local' },
          until: { kind: 'time', at: new Date(2026, 10, 18, 18).getTime() },
          label: 'review chat',
          snoozedAt: 0
        }
      ]
    })
    expect(text).toContain('workspace on runtime:srv')
    expect(text).toContain('until merge')
    expect(text).toMatch(/0123456789ab\s+chat\s+review chat\s+until 6pm/)
    expect(formatSnoozeList({ now: 0, entries: [] })).toBe('Nothing is snoozed.')
  })
})
