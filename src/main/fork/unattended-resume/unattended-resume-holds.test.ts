import { describe, expect, it, vi } from 'vitest'
import {
  readUnattendedResumeHold,
  type UnattendedResumeHoldDatabase
} from './unattended-resume-holds'

type Point = { sessionId: string; operation: { kind: string; operation?: { kind: string } } }

/** A journal database stub: answers the two point reads the holds take. */
function database(options: {
  epoch?: string | null
  stop?: unknown
  cut?: unknown
  fail?: boolean
}): UnattendedResumeHoldDatabase {
  const point = vi.fn(async (request: Point) => {
    if (options.fail) {
      throw new Error('reader gone')
    }
    if (request.operation.kind === 'queue') {
      return {
        kind: 'queue',
        result: { kind: 'user-stop-in-force', stop: options.stop ?? null }
      }
    }
    return { kind: 'usage-limit-cut', cut: options.cut ?? null }
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a stub of the two members the holds read.
  return {
    ensureSessionEpoch: async () => (options.epoch === undefined ? 'epoch-1' : options.epoch),
    readers: { point }
  } as unknown as UnattendedResumeHoldDatabase
}

describe('readUnattendedResumeHold', () => {
  it('holds nothing for a chat with no Stop in force and no limit cut', async () => {
    expect(await readUnattendedResumeHold(database({}), 'chat')).toBeNull()
  })

  it("holds a chat whose person's Stop is still in force", async () => {
    const stop = { sequence: 4, event: { reason: 'user-stop', at: 1 } }
    expect(await readUnattendedResumeHold(database({ stop }), 'chat')).toBe('person-stopped')
  })

  it('holds a chat whose newest turn ended on a usage limit', async () => {
    const cut = { turnItemId: 't', chain: 0, resetsAt: 9 }
    expect(await readUnattendedResumeHold(database({ cut }), 'chat')).toBe('limit-wait')
  })

  it('holds a chat it cannot read', async () => {
    expect(await readUnattendedResumeHold(database({ epoch: null }), 'chat')).toBe('hold-unknown')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await readUnattendedResumeHold(database({ fail: true }), 'chat')).toBe('hold-unknown')
    warn.mockRestore()
  })
})
