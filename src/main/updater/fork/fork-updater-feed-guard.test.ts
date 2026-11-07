import { describe, expect, it, vi } from 'vitest'
import { guardForkUpdaterFeed } from './fork-updater-feed-guard'

function makeUpdater() {
  const setFeedURL = vi.fn()
  return { updater: guardForkUpdaterFeed({ setFeedURL }), setFeedURL }
}

describe('guardForkUpdaterFeed', () => {
  it('passes fork release and local build feeds to the real setFeedURL', () => {
    const { updater, setFeedURL } = makeUpdater()
    const release = {
      provider: 'generic',
      url: 'https://github.com/saltyfireball/orca/releases/latest/download'
    }
    const local = { provider: 'generic', url: 'http://127.0.0.1:50000/feed' }
    updater.setFeedURL(release)
    updater.setFeedURL(local)
    expect(setFeedURL).toHaveBeenNthCalledWith(1, release)
    expect(setFeedURL).toHaveBeenNthCalledWith(2, local)
  })

  it.each([
    { provider: 'generic', url: 'https://github.com/stablyai/orca/releases/latest/download' },
    {
      provider: 'generic',
      url: 'https://github.com/stablyai/orca-daily/releases/download/v1.4.200-daily.202607281400'
    },
    { provider: 'github', owner: 'saltyfireball', repo: 'orca' },
    { provider: 'generic' }
  ])('refuses %j without reaching electron-updater', (options) => {
    const { updater, setFeedURL } = makeUpdater()
    expect(() => updater.setFeedURL(options)).toThrow(/refuse update feed/)
    expect(setFeedURL).not.toHaveBeenCalled()
  })

  it('wraps an updater once', () => {
    const setFeedURL = vi.fn()
    const updater = guardForkUpdaterFeed(guardForkUpdaterFeed({ setFeedURL }))
    updater.setFeedURL({
      provider: 'generic',
      url: 'https://github.com/saltyfireball/orca/releases/latest/download'
    })
    expect(setFeedURL).toHaveBeenCalledTimes(1)
  })
})
