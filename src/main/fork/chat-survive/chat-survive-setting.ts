// SLRM-1394: connects the forkChatSurvive setting to the spawn hook. Read on every spawn, so a
// switch takes effect for the next chat started, with no restart.
import { join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-environment'
import { getForkedChildEntryPath } from '../../worker-threads/forked-child-entry-path'
import { CHAT_SURVIVE_BROKER_ENTRY_FILE } from './chat-survive-launch'
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
    readSetting() === true
      ? {
          enabled: true,
          recordDir,
          entryPath: getForkedChildEntryPath(CHAT_SURVIVE_BROKER_ENTRY_FILE)
        }
      : null
  )
}
