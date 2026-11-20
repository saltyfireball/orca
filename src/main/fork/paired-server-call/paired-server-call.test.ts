import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { boundedForkPairedCall } from './paired-server-call'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

it('rejects a call that never settles with runtime_timeout once its own limit passes (SLRM-2447)', async () => {
  const call = boundedForkPairedCall(() => new Promise<never>(() => {}))
  let failure: unknown = null
  const pending = call('env-wsl', 'fork.digest.local', {}, 4_000).catch((error: unknown) => {
    failure = error
  })
  await vi.advanceTimersByTimeAsync(3_999)
  expect(failure).toBeNull()
  await vi.advanceTimersByTimeAsync(1)
  await pending
  expect(failure).toMatchObject({ code: 'runtime_timeout' })
})

it('passes an answer and a rejection through unchanged', async () => {
  const methodNotFound = Object.assign(new Error('no such method'), {
    code: 'method_not_found'
  })
  const call = boundedForkPairedCall(async (environmentId, method, params, timeoutMs) => {
    if (environmentId === 'old') {
      throw methodNotFound
    }
    return { environmentId, method, params, timeoutMs }
  })
  await expect(call('kif', 'm', { a: 1 }, 4_000)).resolves.toEqual({
    environmentId: 'kif',
    method: 'm',
    params: { a: 1 },
    timeoutMs: 4_000
  })
  await expect(call('old', 'm', {}, 4_000)).rejects.toBe(methodNotFound)
})
