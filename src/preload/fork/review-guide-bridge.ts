// window.api.forkReviewGuide: pull request review guides for the Guide tab (FORK.md "Review
// guides", SLRM-2396).
import { ipcRenderer } from 'electron'
import {
  FORK_REVIEW_GUIDE_CHANNELS as CHANNELS,
  type ForkReviewGuideApi
} from '../../shared/fork/review-guide-wire'

export const forkReviewGuideApi: ForkReviewGuideApi = {
  get: (request) => ipcRenderer.invoke(CHANNELS.get, request),
  write: (request) => ipcRenderer.invoke(CHANNELS.write, request),
  cancel: (request) => ipcRenderer.invoke(CHANNELS.cancel, request)
}
