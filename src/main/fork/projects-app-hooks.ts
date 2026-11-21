// The desktop's project-side fork features, started from one line in src/main/index.ts, which is
// at max-lines: snooze (SLRM-2269), branch clashes (SLRM-2394), review guides (SLRM-2396), and
// the board and letters views (SLRM-2389). See FORK.md.
import { installForkSnoozeApp } from './snooze/snooze-ipc'
import { installForkBranchClashesApp } from './branch-clashes/branch-clashes-app'
import { installForkReviewGuideApp } from './review-guide/review-guide-ipc'
import { mainProcessState } from '../startup/main-process-state'
import { installForkLettersApp } from './letters/letters-ipc'

export function installForkProjectApps(readSettings: () => unknown): void {
  installForkSnoozeApp(readSettings)
  installForkBranchClashesApp(readSettings)
  installForkReviewGuideApp({
    store: () => mainProcessState.store,
    runtime: () => mainProcessState.core.runtime
  })
  installForkLettersApp()
}
