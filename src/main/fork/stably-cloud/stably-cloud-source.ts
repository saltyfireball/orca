// Upstream cloud switch (BAD-896): the main process reads the saved setting on every call, so a
// change reaches each new request with no restart and the stock cloud modules need no store.
import {
  FORK_STABLY_CLOUD_OFF_MESSAGE,
  forkStablyCloudEnabled
} from '../../../shared/fork/stably-cloud'

let readSettings: () => unknown = () => undefined

export function installForkStablyCloudSource(getSettings: () => unknown): void {
  readSettings = getSettings
}

/** True when upstream's hosted services may be called now. */
export function currentForkStablyCloudEnabled(): boolean {
  return forkStablyCloudEnabled(readSettings())
}

/** For code that must stop before a request: throws the off message when the switch is off. */
export function assertForkStablyCloudOn(): void {
  if (!currentForkStablyCloudEnabled()) {
    throw new Error(FORK_STABLY_CLOUD_OFF_MESSAGE)
  }
}

/** The global fetch for a call to an upstream service: refuses once the switch is off, even for a client built while it was on. */
export const forkStablyCloudFetch: typeof globalThis.fetch = (input, init) => {
  assertForkStablyCloudOn()
  return globalThis.fetch(input, init)
}
