import { describe, expect, it, vi } from 'vitest'
import { FORK_HOST_STACK_SCREENS, forkDigestHostAction } from './fork-digest-host-entries'
import { HOST_STACK_SCREENS } from '../../../navigation/host-stack-screens'

describe('digest host entries', () => {
  it('opens the host digest route from the host menu', () => {
    const navigate = vi.fn()
    const action = forkDigestHostAction('/h/abc', false, navigate)
    expect(action.label).toBe('Digest')
    action.onPress()
    expect(navigate).toHaveBeenCalledWith('/h/abc/digest')
    expect(forkDigestHostAction('/h/abc', true, navigate).disabled).toBe(true)
  })

  it('declares the digest screen before the catch-all page', () => {
    const names = HOST_STACK_SCREENS.map((screen) => screen.name)
    expect(FORK_HOST_STACK_SCREENS[0].title).toBe('Digest')
    expect(names.indexOf('[hostId]/digest')).toBeGreaterThan(-1)
    expect(names.indexOf('[hostId]/digest')).toBeLessThan(names.indexOf('[hostId]/[...page]'))
  })
})
