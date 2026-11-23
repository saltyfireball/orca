// Pause all (BAD-685): engaging here asks every paired server, and reports the ones that did
// not answer instead of waiting on them.
import { describe, expect, it, vi } from 'vitest'
import { PAUSE_ALL_OFF, type ForkPauseAllState } from '../../../shared/fork/pause-all'
import {
  readPauseAllEverywhere,
  setPauseAllEverywhere,
  type ForkPauseAllFleetDeps
} from './pause-all-fleet'

function rig(answers: Record<string, 'ok' | 'down' | 'old' | 'forbidden'>) {
  let local: ForkPauseAllState = PAUSE_ALL_OFF
  const calls: { id: string; method: string; params: unknown }[] = []
  const deps: ForkPauseAllFleetDeps = {
    readLocal: () => local,
    setLocal: (engaged, note) => {
      local = engaged ? { engaged: true, since: 1, by: 'cli', note, corrupt: false } : PAUSE_ALL_OFF
      return local
    },
    listEnvironments: () => Object.keys(answers).map((id) => ({ id, name: id })),
    call: vi.fn(async (id: string, method: string, params: unknown) => {
      calls.push({ id, method, params })
      const answer = answers[id]
      if (answer === 'down') {
        throw Object.assign(new Error('timeout'), { code: 'runtime_timeout' })
      }
      if (answer === 'old') {
        throw Object.assign(new Error('no'), { code: 'method_not_found' })
      }
      if (answer === 'forbidden') {
        throw Object.assign(new Error('no'), { code: 'forbidden' })
      }
      return { state: { engaged: (params as { engaged?: boolean }).engaged ?? true } }
    })
  }
  return { deps, calls, local: () => local }
}

describe('setPauseAllEverywhere', () => {
  it('engages here first, relays to every server, and names the ones it could not reach', async () => {
    const r = rig({ alpha: 'ok', bravo: 'down', old: 'old', locked: 'forbidden' })
    const result = await setPauseAllEverywhere(r.deps, {
      engaged: true,
      note: 'maintenance',
      localOnly: false
    })
    expect(result.state.engaged).toBe(true)
    expect(result.hosts).toEqual([
      { name: 'alpha', status: 'applied', engaged: true },
      { name: 'bravo', status: 'unreachable' },
      { name: 'old', status: 'refused', detail: 'this server has no pause-all; update it' },
      { name: 'locked', status: 'refused', detail: 'not allowed to change it' }
    ])
    // Relayed, so a server never fans out again.
    expect(r.calls[0]).toMatchObject({
      method: 'fork.pauseAll.set',
      params: { engaged: true, relayed: true, note: 'maintenance' }
    })
  })

  it('stays on this host when asked, and resumes everywhere', async () => {
    const r = rig({ alpha: 'ok' })
    expect(
      (await setPauseAllEverywhere(r.deps, { engaged: true, note: null, localOnly: true })).hosts
    ).toEqual([])
    expect(r.calls).toEqual([])
    const resumed = await setPauseAllEverywhere(r.deps, {
      engaged: false,
      note: null,
      localOnly: false
    })
    expect(resumed.state.engaged).toBe(false)
    expect(resumed.hosts).toEqual([{ name: 'alpha', status: 'applied', engaged: false }])
  })

  it('reads the fleet for a status check without changing anything', async () => {
    const r = rig({ alpha: 'ok' })
    const read = await readPauseAllEverywhere(r.deps, true)
    expect(read.state.engaged).toBe(false)
    expect(r.calls[0]).toMatchObject({ method: 'fork.pauseAll.status' })
    expect((await readPauseAllEverywhere(r.deps, false)).hosts).toEqual([])
  })
})
