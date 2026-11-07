import { isForkUpdateFeedUrl } from '../../../shared/fork/fork-release-repo'

type FeedOptions = string | { provider?: string; url?: unknown }

type FeedSettable = { setFeedURL(options: FeedOptions): void }

const guardedUpdaters = new WeakSet<object>()

function assertForkUpdateFeed(options: FeedOptions): void {
  const provider = typeof options === 'string' ? 'generic' : options.provider
  const url = typeof options === 'string' ? options : options.url
  // github/s3 providers resolve their own host; only a generic URL can be checked here.
  if (provider !== 'generic' || typeof url !== 'string' || !isForkUpdateFeedUrl(url)) {
    throw new Error(`Fork builds refuse update feed ${JSON.stringify(options)}`)
  }
}

/** Every setFeedURL on the fork's autoUpdater must point at the fork's releases or the local build feed. */
export function guardForkUpdaterFeed<T extends FeedSettable>(updater: T): T {
  if (guardedUpdaters.has(updater)) {
    return updater
  }
  const original = updater.setFeedURL.bind(updater)
  const guarded = (options: FeedOptions): void => {
    assertForkUpdateFeed(options)
    original(options)
  }
  Object.assign(updater, { setFeedURL: guarded })
  guardedUpdaters.add(updater)
  return updater
}
