import { describe, expect, it } from 'vitest'
import type { BotItemLinkView } from '../bots/bot-items'
import { botItemLinkRows, botItemWorkerRow } from '../bots/bot-item-link-rows'
import {
  forkServerWorkerAgo,
  forkServerWorkerLinks,
  forkServerWorkerSeenAt,
  forkServerWorkerState,
  type ForkServerWorkerRead
} from './bot-server-worker'

type DispatchLink = Extract<BotItemLinkView, { kind: 'dispatch' }>

const SERVER_WORKER: DispatchLink = {
  kind: 'dispatch',
  ref: 'ctx_srv',
  latest: null,
  title: 'Fix holophonor',
  state: 'working',
  host: 'studio-server',
  startedAt: 1,
  settledAt: null,
  report: null,
  pr: { shown: false, reason: 'server' },
  server: { environmentId: 'env-1' }
}

const READ: ForkServerWorkerRead = {
  state: 'completed',
  worktreeId: 'repo::/wt/marron',
  seenAt: 900,
  pr: null
}

describe('forkServerWorkerState', () => {
  it('maps the server worker states to item states', () => {
    expect(forkServerWorkerState({ worker: { state: 'succeeded' } })).toBe('completed')
    expect(forkServerWorkerState({ worker: { state: 'failed' } })).toBe('failed')
    expect(forkServerWorkerState({ worker: { state: 'abandoned' } })).toBe('stopped')
    expect(forkServerWorkerState({ worker: { state: 'ready' } })).toBe('working')
    expect(
      forkServerWorkerState({ worker: { state: 'ready' }, observation: { status: 'unverifiable' } })
    ).toBe('unknown')
    expect(forkServerWorkerState({ worker: null })).toBeNull()
  })

  it('reads last activity from the terminal, else the liveness check', () => {
    expect(
      forkServerWorkerSeenAt({
        terminal: { lastOutputAt: 5 },
        projection: { liveness: { observedAt: 3 } }
      })
    ).toBe(5)
    expect(forkServerWorkerSeenAt({ projection: { liveness: { observedAt: 3 } } })).toBe(3)
    expect(forkServerWorkerSeenAt({})).toBeNull()
  })
})

describe('forkServerWorkerLinks', () => {
  it('gives a read server worker its live state and drops the "PR not shown" mark', () => {
    const links = forkServerWorkerLinks([SERVER_WORKER], new Map([['ctx_srv', READ]]))
    expect(links).toEqual([
      {
        ...SERVER_WORKER,
        state: 'completed',
        pr: null,
        server: { environmentId: 'env-1', seenAt: 900 }
      }
    ])
    expect(botItemLinkRows(links).map((row) => row.kind)).toEqual(['worker'])
  })

  it("lists the workspace's PR as the item's PR, read or not", () => {
    const pr = { number: 12, url: 'https://github.com/acme/farnsworth/pull/12' }
    const unread = forkServerWorkerLinks([SERVER_WORKER], new Map([['ctx_srv', { ...READ, pr }]]))
    expect(botItemLinkRows(unread)).toMatchObject([
      { kind: 'worker' },
      { kind: 'github', type: 'pr', number: 12, url: pr.url, state: null }
    ])
    const shown = forkServerWorkerLinks(
      [SERVER_WORKER],
      new Map([['ctx_srv', { ...READ, pr }]]),
      () => ({
        shown: true,
        ref: 'acme/farnsworth#12',
        number: 12,
        url: pr.url,
        state: 'merged',
        checks: null,
        review: null,
        checkedAt: null
      })
    )
    expect(botItemLinkRows(shown)).toMatchObject([
      { kind: 'worker' },
      { kind: 'github', state: 'merged' }
    ])
  })

  it('leaves a worker the server did not answer for, and local workers, as the host read them', () => {
    const local: DispatchLink = { ...SERVER_WORKER, ref: 'ctx_local', host: null, pr: null }
    delete local.server
    const links = [SERVER_WORKER, local]
    expect(forkServerWorkerLinks(links, new Map())).toEqual(links)
    expect(forkServerWorkerLinks(links, new Map([['ctx_local', READ]]))).toEqual(links)
    expect(botItemLinkRows(links).map((row) => row.kind)).toEqual(['worker', 'worker', 'server-pr'])
  })
})

it("names a server worker's host as runtime:<id> and carries its server on the row", () => {
  expect(botItemWorkerRow(SERVER_WORKER)).toMatchObject({
    hostId: 'runtime:env-1',
    forkServer: { environmentId: 'env-1' },
    dispatchId: 'ctx_srv'
  })
  const local = { ...SERVER_WORKER, host: null }
  delete local.server
  expect(botItemWorkerRow(local)).not.toHaveProperty('forkServer')
})

it('says how long ago in the largest whole unit', () => {
  expect(forkServerWorkerAgo(0, 13_000)).toEqual({ count: 13, unit: 's' })
  expect(forkServerWorkerAgo(0, 4 * 60_000 + 5_000)).toEqual({ count: 4, unit: 'min' })
  expect(forkServerWorkerAgo(0, 2 * 3_600_000)).toEqual({ count: 2, unit: 'h' })
  expect(forkServerWorkerAgo(0, 3 * 86_400_000)).toEqual({ count: 3, unit: 'd' })
  expect(forkServerWorkerAgo(10, 0)).toEqual({ count: 0, unit: 's' })
})
