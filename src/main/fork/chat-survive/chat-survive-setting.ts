// SLRM-1394: connects the forkChatSurvive setting to the spawn hook. Read on every spawn, so a
// switch takes effect for the next chat started, with no restart.
import { join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-environment'
import { getForkedChildEntryPath } from '../../worker-threads/forked-child-entry-path'
import type { ProfilePreferences } from '../../persistence/loading-store/profile-preferences/profile-preferences'
import { CHAT_SURVIVE_BROKER_ENTRY_FILE } from './chat-survive-launch'
import { refreshChatSurviveLaunchReady } from './chat-survive-launch-ready'
import { setChatSurviveConfigReader } from './chat-survive-spawn'
import { sweepChatSurviveRecords } from './chat-survive-sweep'

export function installChatSurviveSettingReader(
  readSetting: () => boolean | undefined,
  userDataPath: string = getAppEnvironment().getPath('userData')
): void {
  const recordDir = join(userDataPath, 'chat-survive')
  // Before recovery reads them: records of brokers that died with their machine or a SIGKILL.
  sweepChatSurviveRecords(recordDir)
  setChatSurviveConfigReader(() =>
    // Anything but an explicit true is off, and then nothing else is looked up.
    readSetting() === true ? { enabled: true, recordDir, entryPath: brokerEntryPath() } : null
  )
}

function brokerEntryPath(): string {
  return getForkedChildEntryPath(CHAT_SURVIVE_BROKER_ENTRY_FILE)
}

/**
 * The desktop app's install: the setting reader, plus the spawn's disk checks (SLRM-2138). With
 * the setting on, resolves once the first check is done; start-up awaits it before any session
 * is restored, so no chat spawns ahead of it. Switching the setting on checks again at once; a
 * chat started within the few milliseconds that check takes still runs without chat survive.
 */
export async function installForkChatSurvive(
  store: Pick<ProfilePreferences, 'getSettings' | 'onSettingsChanged'>
): Promise<void> {
  installChatSurviveSettingReader(() => store.getSettings().forkChatSurvive)
  store.onSettingsChanged((updates) => {
    if (updates.forkChatSurvive === true) {
      void refreshChatSurviveLaunchReady(brokerEntryPath())
    }
  })
  if (store.getSettings().forkChatSurvive === true) {
    await refreshChatSurviveLaunchReady(brokerEntryPath())
  }
}
