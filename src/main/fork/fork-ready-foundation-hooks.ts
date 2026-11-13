// The fork's hooks in main-process-ready-foundation.ts, behind one import so that upstream file
// stays inside its line limit (SLRM-2138).
import type { ProfilePreferences } from '../persistence/loading-store/profile-preferences/profile-preferences'
import { installForkChatSurvive } from './chat-survive/chat-survive-setting'
import { watchForkUsageRetention } from './usage-ledger/usage-ledger-service'

export { forkPostReadyAppName } from './app-name'

/**
 * Store-bound fork installs. Resolves once chat survive's first disk check is done (when it is on),
 * so the sessions restored after this never spawn ahead of it.
 */
export async function installForkReady(
  store: Pick<ProfilePreferences, 'getSettings' | 'onSettingsChanged'>
): Promise<void> {
  watchForkUsageRetention(store)
  await installForkChatSurvive(store)
}
