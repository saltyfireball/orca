// window.api.forkLimitResume: parked chats and terminal agents for the "resumes at" labels
// (FORK.md "Limit resume", SLRM-2309).
import { ipcRenderer } from 'electron'
import type { LimitResumeEntry } from '../../shared/fork/limit-resume'
import {
  FORK_LIMIT_RESUME_CHANNELS as CHANNELS,
  type ForkLimitResumeApi
} from '../../shared/fork/limit-resume-wire'

export const forkLimitResumeApi: ForkLimitResumeApi = {
  list: () => ipcRenderer.invoke(CHANNELS.list),
  onChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, entries: LimitResumeEntry[]) =>
      callback(entries)
    ipcRenderer.on(CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(CHANNELS.changed, listener)
  }
}
