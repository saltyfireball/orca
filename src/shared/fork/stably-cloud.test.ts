// Upstream cloud switch (BAD-896): a saved boolean wins, anything else follows the build default,
// and a build that sets no default is off.
import { describe, expect, it } from 'vitest'
import { forkStablyCloudEnabled } from './stably-cloud'

describe('forkStablyCloudEnabled', () => {
  it.each([
    [undefined, false, false],
    [{}, false, false],
    [{}, true, true],
    [{ forkStablyCloudEnabled: 'yes' }, false, false],
    [{ forkStablyCloudEnabled: true }, false, true],
    [{ forkStablyCloudEnabled: false }, true, false],
    [null, true, true]
  ])('%j with build default %s is %s', (settings, buildDefault, expected) => {
    expect(forkStablyCloudEnabled(settings, buildDefault)).toBe(expected)
  })
})
