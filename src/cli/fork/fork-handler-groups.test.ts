import { describe, expect, it } from 'vitest'
import { FORK_HANDLER_GROUPS } from './fork-handler-groups'
import { FORK_GUARDS_COMMAND_SPECS } from './guards-specs'

describe('FORK_HANDLER_GROUPS', () => {
  it('routes every key its handlers register, and registers every key it routes', async () => {
    for (const group of FORK_HANDLER_GROUPS) {
      const handlers = await group.load()
      expect({ group: group.name, keys: Object.keys(handlers).sort() }).toEqual({
        group: group.name,
        keys: [...group.keys].sort()
      })
    }
  })

  it('routes every documented guards command (BAD-766)', () => {
    const guards = FORK_HANDLER_GROUPS.find((group) => group.name === 'fork-guards')
    for (const spec of FORK_GUARDS_COMMAND_SPECS) {
      expect(guards?.keys).toContain(spec.path.join(' '))
    }
  })
})
