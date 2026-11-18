// Review guides (SLRM-2396, FORK.md): the desktop window's side. The window names a project by id
// and main looks up its checkout; only the main window may ask. Projects on an SSH host are
// refused: a guide is written on the machine that holds the checkout.
import { ipcMain } from 'electron'
import type { Repo } from '../../../shared/repository/repo-types'
import {
  FORK_REVIEW_GUIDE_CHANNELS as CHANNELS,
  ForkReviewGuideWindowRequestSchema,
  type ForkReviewGuideState
} from '../../../shared/fork/review-guide-wire'
import type { GlobalSettings } from '../../../shared/settings/global-settings-types'
import type { CommitMessageAgentEnvironmentResolvers } from '../../text-generation/execution/commit-message-agent-environment'
import { mainProcessState } from '../../startup/main-process-state'
import {
  forkReviewGuideLocalCheckout,
  forkReviewGuideService,
  type ForkReviewGuideCheckout,
  type ForkReviewGuideHost
} from './review-guide-service'

export type ForkReviewGuideAppDeps = {
  store: () => { getSettings: () => GlobalSettings; getRepos: () => readonly Repo[] } | null
  runtime: () => {
    getCommitMessageAgentEnvironmentResolvers: () =>
      | CommitMessageAgentEnvironmentResolvers
      | undefined
  } | null
}

/** Main-process start-up hook. */
export function installForkReviewGuideApp(deps: ForkReviewGuideAppDeps): void {
  const service = forkReviewGuideService()
  const fromMainWindow = (event: Electron.IpcMainInvokeEvent): boolean => {
    const window = mainProcessState.mainWindow
    return !!window && !window.isDestroyed() && event.sender === window.webContents
  }
  const handle = (
    channel: string,
    act: (
      host: ForkReviewGuideHost,
      checkout: ForkReviewGuideCheckout,
      headSha: string | null
    ) => Promise<ForkReviewGuideState>
  ) =>
    ipcMain.handle(channel, async (event, request: unknown) => {
      const parsed = ForkReviewGuideWindowRequestSchema.safeParse(request)
      const store = deps.store()
      if (!fromMainWindow(event) || !parsed.success || !store) {
        throw new Error('Review guide request refused.')
      }
      const { repoId, pr, prRepo, headSha } = parsed.data
      const checkout = forkReviewGuideLocalCheckout(
        store.getRepos(),
        (repo) => repo.id === repoId,
        pr,
        prRepo ?? null
      )
      const host = {
        settings: store.getSettings(),
        agentEnvironment: deps.runtime()?.getCommitMessageAgentEnvironmentResolvers()
      }
      return act(host, checkout, headSha ?? null)
    })
  handle(CHANNELS.get, (host, checkout, headSha) => service.state(host, checkout, headSha))
  handle(CHANNELS.write, (host, checkout) => service.write(host, checkout))
  handle(CHANNELS.cancel, (host, checkout) => service.cancel(host, checkout))
}
