import { describe, expect, it } from 'vitest'
import { withForkReservedPorts, withForkReservedPortsText } from './worktree-ports-cli'
import { RuntimeClientError } from '../runtime/connection/types'

const scan = { executionHostId: 'local', ports: [] }

describe('orca ports reserved block', () => {
  it('adds the block the host holds for the workspace', async () => {
    const calls: unknown[] = []
    const client = {
      call: async (method: string, params: unknown) => {
        calls.push([method, params])
        return {
          result: {
            worktreeId: 'repo::/w/a',
            enabled: true,
            block: { worktreeId: 'repo::/w/a', start: 20010, count: 3, reservedAt: 1 }
          }
        }
      }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a fake answering one method; only call is used.
    const result = await withForkReservedPorts(client as never, 'id:repo::/w/a', scan)
    expect(calls).toEqual([['fork.worktreePorts.get', { worktree: 'id:repo::/w/a' }]])
    expect(result.reservedPorts).toEqual({
      enabled: true,
      start: 20010,
      count: 3,
      ports: [20010, 20011, 20012]
    })
    expect(withForkReservedPortsText(result, 'No listening ports found.')).toBe(
      'No listening ports found.\nreserved=20010-20012 (ORCA_PORT=20010, ORCA_PORT_0..2)'
    )
  })

  it('leaves the scan alone when the host has no such method', async () => {
    const client = {
      call: async () => {
        throw new RuntimeClientError('method_not_found', 'no')
      }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a fake that only throws; only call is used.
    const result = await withForkReservedPorts(client as never, 'id:x', scan)
    expect(result).toEqual(scan)
    expect(withForkReservedPortsText(result, 'text')).toBe('text')
  })
})
