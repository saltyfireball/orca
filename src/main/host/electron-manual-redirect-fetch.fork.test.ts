// Fork test: the request goes out on the session it is given, so it takes that session's proxy route
// (browser tab icons on an SSH-routed tab). Kept apart from upstream's redirect tests, which upstream
// cut from its suite.
import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'

class FakeRequest extends EventEmitter {
  readonly abort = vi.fn()
  readonly end = vi.fn()
}

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('electron', () => ({ net: { request } }))

import { fetchWithElectronManualRedirects } from './electron-manual-redirect-fetch'

let native: FakeRequest

beforeEach(() => {
  native = new FakeRequest()
  request.mockReset().mockReturnValue(native)
})

it("sends the request on the given session, so it takes that session's proxy route", async () => {
  const routed = { id: 'routed-session' }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the session is only handed to the mocked net.request
  const pending = fetchWithElectronManualRedirects('https://site.test/i.png', {}, routed as never)
  native.emit('redirect', 302, 'GET', 'https://site.test/j.png', {})
  await pending

  expect(request).toHaveBeenCalledWith(expect.objectContaining({ session: routed }))
})
