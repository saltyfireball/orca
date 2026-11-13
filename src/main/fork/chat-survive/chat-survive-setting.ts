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
 * The desktop app's install: the setting reader, plus the spawn's disk checks run ahead of the
 * first chat at start and whenever the setting is switched on (SLRM-2138).
 */
export function installForkChatSurvive(
  store: Pick<ProfilePreferences, 'getSettings' | 'onSettingsChanged'>
): void {
  installChatSurviveSettingReader(() => store.getSettings().forkChatSurvive)
  const prime = (): void => void refreshChatSurviveLaunchReady(brokerEntryPath())
  if (store.getSettings().forkChatSurvive === true) {
    prime()
  }
  store.onSettingsChanged((updates) => {
    if (updates.forkChatSurvive === true) {
      prime()
    }
  })
}
