// window.api.forkThirdPartyNotices: opens the bundled third-party notices (FORK.md "Third-party notices").
import { ipcRenderer } from 'electron'
import {
  FORK_THIRD_PARTY_NOTICES_CHANNELS,
  type ForkThirdPartyNoticesApi
} from '../../shared/fork/third-party-notices'

export const forkThirdPartyNoticesApi: ForkThirdPartyNoticesApi = {
  open: () => ipcRenderer.invoke(FORK_THIRD_PARTY_NOTICES_CHANNELS.open)
}
