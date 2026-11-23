// Fork test (SLRM-2309): a continuing stop stays for as long as the host publishes it. Kept apart from
// upstream's usage-limit stop tests, which upstream cut from its suite.
import { expect, it } from 'vitest'
import { usageLimitStopOf } from './bot-usage-limit-stop'

const RESET = 2_000_000

it('keeps a continuing stop past its time for as long as the host publishes it', () => {
  const cut = { turnItemId: 't', resetsAt: RESET, state: 'scheduled' } as const
  expect(usageLimitStopOf({ usageLimitContinue: cut }, RESET + 16 * 3_600_000)).toEqual({
    at: RESET,
    auto: true
  })
})
