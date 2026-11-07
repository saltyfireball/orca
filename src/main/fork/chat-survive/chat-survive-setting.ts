// SLRM-1394: connects the forkChatSurvive setting to the spawn hook. Read on every spawn, so a
// switch takes effect for the next chat started, with no restart.
import { join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-environment'
import { getForkedChildEntryPath } from '../../worker-threads/forked-child-entry-path'
import { CHAT_SURVIVE_BROKER_ENTRY_FILE } from './chat-survive-launch'
import { setChatSurviveConfigReader } from './chat-survive-spawn'

export function installChatSurviveSettingReader(
  readSetting: () => boolean | undefined,
  userDataPath: string = getAppEnvironment().getPath('userData')
): void {
  const recordDir = join(userDataPath, 'chat-survive')
  setChatSurviveConfigReader(() => ({
    // Anything but an explicit true is off.
    enabled: readSetting() === true,
    recordDir,
    entryPath: getForkedChildEntryPath(CHAT_SURVIVE_BROKER_ENTRY_FILE)
  }))
}
