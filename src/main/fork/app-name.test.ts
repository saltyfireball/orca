import { describe, expect, it } from 'vitest'
import { getDevInstanceIdentity } from '../startup/dev-instance-identity'
import { FORK_DATA_DIR_NAME, FORK_PRE_READY_APP_NAME, forkPostReadyAppName } from './app-name'

describe('forkPostReadyAppName', () => {
  it('names packaged builds Blackfish after ready', () => {
    expect(forkPostReadyAppName(getDevInstanceIdentity(false))).toBe('Blackfish')
  })

  it('keeps the dev identity name in dev', () => {
    const identity = getDevInstanceIdentity(true, { ORCA_DEV_BRANCH: 'main' })
    expect(forkPostReadyAppName(identity)).toBe(identity.appName)
  })

  it('keeps the pre-rename data folder and Keychain name', () => {
    expect(FORK_DATA_DIR_NAME).toBe('Orca Fork')
    expect(FORK_PRE_READY_APP_NAME).toBe('Orca Fork')
  })
})
