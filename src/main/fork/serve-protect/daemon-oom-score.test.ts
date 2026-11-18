// SLRM-2384: the terminal daemon raises its own OOM score to the protect drop-in's child value,
// with a fake /proc, never lowering it and never on other systems.
import { describe, expect, it } from 'vitest'
import { forkRaiseDaemonOomScore, type DaemonOomScoreIo } from './daemon-oom-score'
import { SERVE_PROTECT_CHILD_OOM_ENV } from '../../../shared/fork/serve-protect'

function io(current: string): DaemonOomScoreIo & { written: string[] } {
  const written: string[] = []
  return {
    written,
    read: async () => current,
    write: async (_path, value) => {
      written.push(value)
    }
  }
}

describe('forkRaiseDaemonOomScore', () => {
  it('raises the score to the child value', async () => {
    const proc = io('100\n')
    expect(
      await forkRaiseDaemonOomScore({ [SERVE_PROTECT_CHILD_OOM_ENV]: '300' }, 'linux', proc)
    ).toBe(300)
    expect(proc.written).toEqual(['300'])
  })

  it('never lowers it, and ignores bad values, other systems and no value', async () => {
    const proc = io('400\n')
    expect(
      await forkRaiseDaemonOomScore({ [SERVE_PROTECT_CHILD_OOM_ENV]: '300' }, 'linux', proc)
    ).toBeNull()
    expect(
      await forkRaiseDaemonOomScore({ [SERVE_PROTECT_CHILD_OOM_ENV]: 'lots' }, 'linux', proc)
    ).toBeNull()
    expect(
      await forkRaiseDaemonOomScore({ [SERVE_PROTECT_CHILD_OOM_ENV]: '900' }, 'darwin', proc)
    ).toBeNull()
    expect(await forkRaiseDaemonOomScore({}, 'linux', proc)).toBeNull()
    expect(proc.written).toEqual([])
  })

  it('swallows a write the kernel refuses', async () => {
    const proc: DaemonOomScoreIo = {
      read: async () => '0',
      write: async () => {
        throw new Error('EACCES')
      }
    }
    expect(
      await forkRaiseDaemonOomScore({ [SERVE_PROTECT_CHILD_OOM_ENV]: '300' }, 'linux', proc)
    ).toBeNull()
  })
})
